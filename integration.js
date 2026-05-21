'use strict';

const request = require('postman-request');
const async = require('async');
const fs = require('fs');
const _ = require('lodash');
const config = require('./config/config');

let Logger;
let requestWithDefaults;

// ── Site cache ──────────────────────────────────────────────────────────────
let sitesCache = [];
let sitesCacheExpiry = 0;
const SITES_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Blocklist state ──────────────────────────────────────────────────────────
let previousIpRegexAsString = '';
let ipBlocklistRegex = null;

// ── Constants ────────────────────────────────────────────────────────────────
const IGNORED_IPS = new Set(['127.0.0.1', '255.255.255.255', '0.0.0.0']);
const MAX_PARALLEL_LOOKUPS = 10;

/**
 * Called once when the integration process starts.
 * Sets up postman-request defaults (cert, key, proxy, CA, rejectUnauthorized).
 * Does NOT call the API here — options are not available yet.
 */
function startup(logger) {
  let defaults = {};
  Logger = logger;

  const { cert, key, passphrase, ca, proxy, rejectUnauthorized } = config.request;

  if (typeof cert === 'string' && cert.length > 0) {
    defaults.cert = fs.readFileSync(cert);
  }

  if (typeof key === 'string' && key.length > 0) {
    defaults.key = fs.readFileSync(key);
  }

  if (typeof passphrase === 'string' && passphrase.length > 0) {
    defaults.passphrase = passphrase;
  }

  if (typeof ca === 'string' && ca.length > 0) {
    defaults.ca = fs.readFileSync(ca);
  }

  if (typeof proxy === 'string' && proxy.length > 0) {
    defaults.proxy = proxy;
  }

  if (typeof rejectUnauthorized === 'boolean') {
    defaults.rejectUnauthorized = rejectUnauthorized;
  }

  requestWithDefaults = request.defaults(defaults);
}

// ── Blocklist helpers ─────────────────────────────────────────────────────────

function _setupRegexBlocklists(options) {
  // Guard against null/undefined option value
  const regexStr = options.ipBlocklistRegex || '';
  if (regexStr !== previousIpRegexAsString && regexStr.length === 0) {
    Logger.debug('Removing IP blocklist Regex Filtering');
    previousIpRegexAsString = '';
    ipBlocklistRegex = null;
  } else {
    if (regexStr !== previousIpRegexAsString) {
      previousIpRegexAsString = regexStr;
      Logger.debug({ ipBlocklistRegex: previousIpRegexAsString }, 'Modifying IP blocklist Regex');
      ipBlocklistRegex = new RegExp(regexStr, 'i');
    }
  }
}

function _isEntityBlocklisted(entity, options) {
  // Parse the comma-separated blocklist string into an array for exact-match comparison.
  // Using _.includes() on the raw string would do a substring check (false positives).
  const blocklistArr = (options.blocklist || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  Logger.trace({ blocklistArr }, 'blocklist Values');

  const entityIsBlocklisted = blocklistArr.includes(entity.value.toLowerCase());
  const ipIsBlocklisted = entity.isIP && ipBlocklistRegex !== null && ipBlocklistRegex.test(entity.value);

  if (ipIsBlocklisted) Logger.debug({ ip: entity.value }, 'Blocked blocklisted IP lookup');

  return entityIsBlocklisted || ipIsBlocklisted;
}

function _isInvalidEntity(entity) {
  return entity.isIPv4 && IGNORED_IPS.has(entity.value);
}

// ── Site cache helper ─────────────────────────────────────────────────────────

/**
 * Returns cached sites or fetches a fresh list from the controller.
 * Cache expires after SITES_CACHE_TTL_MS (1 hour).
 * @param {Object} options - user options (url, apiKey)
 * @param {Function} cb - callback(err, sites[])
 */
function _getSitesCache(options, cb) {
  const now = Date.now();

  if (sitesCache.length > 0 && now < sitesCacheExpiry) {
    Logger.trace({ siteCount: sitesCache.length }, 'Using cached sites');
    return cb(null, sitesCache);
  }

  const baseUrl = options.url.replace(/\/$/, '');
  const requestOptions = {
    method: 'GET',
    uri: `${baseUrl}/v1/sites`,
    headers: {
      'X-API-KEY': options.apiKey,
      'Content-Type': 'application/json'
    },
    json: true
  };

  Logger.debug({ uri: requestOptions.uri }, 'Fetching sites from UniFi controller');

  requestWithDefaults(requestOptions, (error, res, body) => {
    const restError = handleRestError(error, null, res, body);
    if (restError) {
      return cb(restError);
    }

    const sites = (body && Array.isArray(body.data)) ? body.data : [];
    sitesCache = sites;
    sitesCacheExpiry = Date.now() + SITES_CACHE_TTL_MS;

    Logger.debug({ siteCount: sites.length }, 'Sites fetched and cached');
    cb(null, sites);
  });
}

// ── Search helpers ────────────────────────────────────────────────────────────

/**
 * Search for connected clients matching the entity (IP or MAC) on a specific site.
 * @param {string} siteId
 * @param {string} siteName
 * @param {Object} entity
 * @param {Object} options
 * @param {Function} cb - callback(err, clientResults[])
 */
function _searchClients(siteId, siteName, entity, options, cb) {
  const baseUrl = options.url.replace(/\/$/, '');
  const filterField = entity.isIP ? 'ipAddress' : 'macAddress';
  const filterValue = entity.value;

  const requestOptions = {
    method: 'GET',
    uri: `${baseUrl}/v1/sites/${siteId}/clients`,
    qs: {
      filter: `${filterField}.eq('${filterValue}')`
    },
    headers: {
      'X-API-KEY': options.apiKey,
      'Content-Type': 'application/json'
    },
    json: true
  };

  Logger.trace({ siteId, filter: requestOptions.qs.filter }, 'Searching clients');

  requestWithDefaults(requestOptions, (error, res, body) => {
    const restError = handleRestError(error, entity, res, body);
    if (restError) {
      return cb(restError);
    }

    const clients = (body && Array.isArray(body.data)) ? body.data : [];

    // Normalize clientId: the UniFi API returns the UUID as `id`.
    // We explicitly map it to `clientId` so the block/reconnect actions in
    // onMessage always have the correct field regardless of API version.
    const enriched = clients.map((c) => ({
      ...c,
      clientId: c.id || c.clientId || c._id || '',
      siteId,
      siteName
    }));

    cb(null, enriched);
  });
}

/**
 * Search for infrastructure devices matching the entity (IP or MAC) on a specific site.
 * Falls back to full list + client-side filter if the filter query param isn't supported.
 * @param {string} siteId
 * @param {string} siteName
 * @param {Object} entity
 * @param {Object} options
 * @param {Function} cb - callback(err, deviceResults[])
 */
function _searchDevices(siteId, siteName, entity, options, cb) {
  const baseUrl = options.url.replace(/\/$/, '');
  const filterField = entity.isIP ? 'ipAddress' : 'macAddress';
  const filterValue = entity.value;

  const requestOptions = {
    method: 'GET',
    uri: `${baseUrl}/v1/sites/${siteId}/devices`,
    qs: {
      filter: `${filterField}.eq('${filterValue}')`
    },
    headers: {
      'X-API-KEY': options.apiKey,
      'Content-Type': 'application/json'
    },
    json: true
  };

  Logger.trace({ siteId, filter: requestOptions.qs.filter }, 'Searching devices (with filter)');

  requestWithDefaults(requestOptions, (error, res, body) => {
    // If filter not supported (400 or returns all devices unexpectedly), fall back to full list
    if (!error && res && res.statusCode === 400) {
      Logger.debug({ siteId }, 'Device filter returned 400 — falling back to full device list');
      return _searchDevicesFallback(siteId, siteName, entity, options, cb);
    }

    const restError = handleRestError(error, entity, res, body);
    if (restError) {
      return cb(restError);
    }

    const devices = (body && Array.isArray(body.data)) ? body.data : [];

    // Always apply client-side filtering regardless of result count.
    // Some controller versions ignore the filter query parameter entirely and
    // return all devices. A `devices.length > 1` heuristic was unreliable —
    // it would skip filtering when only 1 device existed in the site, allowing
    // false-positive results through when the filter was ignored.
    const filtered = devices.filter((d) =>
      entity.isIP
        ? d.ipAddress === entity.value
        : (d.macAddress || '').toLowerCase() === entity.value.toLowerCase()
    );

    const enriched = filtered.map((d) => ({ ...d, siteId, siteName }));
    cb(null, enriched);
  });
}

/**
 * Fallback: fetch all devices and filter client-side.
 */
function _searchDevicesFallback(siteId, siteName, entity, options, cb) {
  const baseUrl = options.url.replace(/\/$/, '');

  const requestOptions = {
    method: 'GET',
    uri: `${baseUrl}/v1/sites/${siteId}/devices`,
    headers: {
      'X-API-KEY': options.apiKey,
      'Content-Type': 'application/json'
    },
    json: true
  };

  requestWithDefaults(requestOptions, (error, res, body) => {
    const restError = handleRestError(error, entity, res, body);
    if (restError) {
      return cb(restError);
    }

    const allDevices = (body && Array.isArray(body.data)) ? body.data : [];

    const filtered = allDevices.filter((d) =>
      entity.isIP
        ? d.ipAddress === entity.value
        : (d.macAddress || '').toLowerCase() === entity.value.toLowerCase()
    );

    const enriched = filtered.map((d) => ({ ...d, siteId, siteName }));
    cb(null, enriched);
  });
}

/**
 * Execute a block or reconnect action on a client.
 * @param {string} siteId
 * @param {string} clientId - UUID from the client list response
 * @param {string} action - 'block' | 'reconnect'
 * @param {Object} options
 * @param {Function} cb - callback(err, response)
 */
function _executeClientAction(siteId, clientId, action, options, cb) {
  const baseUrl = options.url.replace(/\/$/, '');

  const requestOptions = {
    method: 'POST',
    uri: `${baseUrl}/v1/sites/${siteId}/clients/${clientId}/actions`,
    headers: {
      'X-API-KEY': options.apiKey,
      'Content-Type': 'application/json'
    },
    body: { action },
    json: true
  };

  Logger.debug({ siteId, clientId, action }, 'Executing client action');

  requestWithDefaults(requestOptions, (error, res, body) => {
    const restError = handleRestError(error, null, res, body);
    if (restError) {
      return cb(restError);
    }
    cb(null, body || {});
  });
}

// ── doLookup ──────────────────────────────────────────────────────────────────

function doLookup(entities, options, cb) {
  let lookupResults = [];
  let tasks = [];

  Logger.debug({ entityCount: entities.length }, 'Starting doLookup');

  _setupRegexBlocklists(options);

  entities.forEach((entity) => {
    if (_isInvalidEntity(entity) || _isEntityBlocklisted(entity, options)) {
      return;
    }

    // Only process IPv4 and MAC Address entities
    if (!entity.isIP && !entity.isMACAddress) {
      return;
    }

    tasks.push((done) => {
      // Step 1: get (possibly cached) site list
      _getSitesCache(options, (siteErr, sites) => {
        if (siteErr) {
          return done(null, {
            entity,
            data: {
              summary: ['Error fetching sites'],
              details: { error: siteErr.detail || 'Failed to fetch UniFi sites' }
            }
          });
        }

        if (!sites || sites.length === 0) {
          return done(null, { entity, data: null });
        }

        // Step 2: for each site, run clients + devices in parallel
        const perSiteTasks = sites.flatMap((site) => {
          const siteId = site.siteId;
          const siteName = site.name || site.meta?.desc || siteId;

          return [
            (siteDone) => _searchClients(siteId, siteName, entity, options, siteDone),
            (siteDone) => _searchDevices(siteId, siteName, entity, options, siteDone)
          ];
        });

        async.parallelLimit(perSiteTasks, MAX_PARALLEL_LOOKUPS, (parallelErr, siteResults) => {
          if (parallelErr) {
            Logger.error({ parallelErr }, 'Error in parallel site lookup');
            return done(null, {
              entity,
              data: {
                summary: ['Lookup error'],
                details: { error: parallelErr.detail || 'Error querying UniFi sites' }
              }
            });
          }

          // siteResults alternates: [clientResults, deviceResults, clientResults, deviceResults, ...]
          let allClients = [];
          let allDevices = [];

          for (let i = 0; i < siteResults.length; i += 2) {
            allClients = allClients.concat(siteResults[i] || []);
            allDevices = allDevices.concat(siteResults[i + 1] || []);
          }

          if (allClients.length === 0 && allDevices.length === 0) {
            return done(null, { entity, data: null });
          }

          const details = {
            clients: allClients,
            devices: allDevices
          };

          done(null, { entity, data: { summary: _buildSummaryTags(details), details } });
        });
      });
    });
  });

  if (tasks.length === 0) {
    return cb(null, lookupResults);
  }

  async.parallelLimit(tasks, MAX_PARALLEL_LOOKUPS, (err, results) => {
    if (err) {
      return cb(err);
    }
    lookupResults = results;
    Logger.trace({ lookupResults }, 'doLookup complete');
    cb(null, lookupResults);
  });
}

/**
 * Build summary tag strings for the Polarity pill.
 */
function _buildSummaryTags(details) {
  const tags = [];

  (details.clients || []).forEach((client) => {
    if (client.status === 'BLOCKED') {
      tags.push('⛔ Blocked');
    } else if (client.status === 'CONNECTED') {
      tags.push('✅ Connected');
    } else {
      tags.push('🖥 Client');
    }
    if (client.name) tags.push(client.name);
  });

  (details.devices || []).forEach((device) => {
    tags.push('📡 Device');
    if (device.state === 'ONLINE') {
      tags.push('🟢 Online');
    } else if (device.state === 'OFFLINE') {
      tags.push('🔴 Offline');
    }
    if (device.model) tags.push(device.model);
  });

  return tags;
}

// ── onMessage ─────────────────────────────────────────────────────────────────

function onMessage(payload, options, cb) {
  Logger.debug({ payload }, 'onMessage received');

  switch (payload.action) {
    case 'BLOCK_CLIENT':
      _executeClientAction(payload.siteId, payload.clientId, 'block', options, (err) => {
        if (err) {
          Logger.error({ err, payload }, 'Failed to block client');
          return cb(null, { success: false, message: err.detail || 'Failed to block client' });
        }
        Logger.debug({ clientId: payload.clientId }, 'Client blocked successfully');
        cb(null, { success: true, newStatus: 'BLOCKED' });
      });
      break;

    case 'RECONNECT_CLIENT':
      _executeClientAction(payload.siteId, payload.clientId, 'reconnect', options, (err) => {
        if (err) {
          Logger.error({ err, payload }, 'Failed to reconnect client');
          return cb(null, { success: false, message: err.detail || 'Failed to reconnect client' });
        }
        Logger.debug({ clientId: payload.clientId }, 'Client reconnected successfully');
        cb(null, { success: true, newStatus: 'CONNECTED' });
      });
      break;

    default:
      Logger.warn({ action: payload.action }, 'Unknown onMessage action');
      cb(null, { success: false, message: `Unknown action: ${payload.action}` });
  }
}

// ── validateOptions ───────────────────────────────────────────────────────────

function validateOptions(userOptions, cb) {
  const errors = [];

  if (
    typeof userOptions.url.value !== 'string' ||
    userOptions.url.value.trim().length === 0
  ) {
    errors.push({
      key: 'url',
      message: 'You must provide a UniFi controller URL (e.g., https://192.168.1.1)'
    });
  } else if (userOptions.url.value.trim().endsWith('/')) {
    errors.push({
      key: 'url',
      message: 'The UniFi controller URL must not end with a trailing slash'
    });
  }

  if (
    typeof userOptions.apiKey.value !== 'string' ||
    userOptions.apiKey.value.trim().length === 0
  ) {
    errors.push({
      key: 'apiKey',
      message: 'You must provide a UniFi API Key'
    });
  }

  cb(null, errors);
}

// ── Error handling ────────────────────────────────────────────────────────────

function handleRestError(error, entity, res, body) {
  let result;

  if (error) {
    result = {
      error,
      detail: 'HTTP Request Error'
    };
    return result;
  }

  if (!res) {
    return {
      error: 'No response received',
      detail: 'No HTTP response was received from the UniFi controller'
    };
  }

  if (res.statusCode === 200) {
    return null;
  }

  if (res.statusCode === 404) {
    // Not found — treat as no result
    return null;
  }

  if (res.statusCode === 401) {
    result = {
      error: 'Unauthorized',
      detail: 'Invalid API Key — please verify your UniFi API Key in the integration settings'
    };
    return result;
  }

  if (res.statusCode === 403) {
    result = {
      error: 'Forbidden',
      detail: 'Forbidden — check that your API Key has the required permissions'
    };
    return result;
  }

  if (res.statusCode === 400) {
    const message = (body && (body.message || body.detail || JSON.stringify(body))) || 'Bad Request';
    result = {
      error: 'Bad Request',
      detail: message
    };
    return result;
  }

  result = {
    error: `Unexpected HTTP status: ${res.statusCode}`,
    detail: (body && (body.message || JSON.stringify(body))) || `HTTP ${res.statusCode} received from UniFi controller`
  };

  return result;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  startup,
  doLookup,
  onMessage,
  validateOptions
};
