'use strict';

module.exports = {
  /**
   * @type Array
   * @optional
   */
  logging: {
    level: 'info'
  },
  /**
   * Options that are displayed to the user/admin in the Polarity integration settings page and
   * returned as part of the `options` object passed to the `startup`, `validateOptions`,
   * `onMessage` and `doLookup` callbacks.
   *
   * @type Array
   * @optional
   */
  options: [
    {
      key: 'url',
      name: 'UniFi Controller URL',
      description:
        'The base URL of your on-premise UniFi Network controller. Must NOT end with a trailing slash. Example: https://192.168.1.1/proxy/network/integration',
      default: '',
      type: 'text',
      userCanEdit: false,
      adminOnly: true
    },
    {
      key: 'apiKey',
      name: 'API Key',
      description:
        'Your UniFi Network controller API Key. Generate one from the controller UI under Settings → API.',
      default: '',
      type: 'password',
      userCanEdit: false,
      adminOnly: true
    },
    {
      key: 'blocklist',
      name: 'Ignored Entities',
      description:
        'Comma-separated list of IP addresses or MAC addresses to ignore during lookup.',
      default: '',
      type: 'text',
      userCanEdit: false,
      adminOnly: false
    },
    {
      key: 'ipBlocklistRegex',
      name: 'IP Blocklist Regex',
      description:
        'IP addresses matching this regex will not be looked up. Leave blank to query all IP addresses.',
      default: '',
      type: 'text',
      userCanEdit: false,
      adminOnly: false
    }
  ]
};
