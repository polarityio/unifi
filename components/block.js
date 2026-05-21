polarity.export = PolarityComponent.extend({
  details: Ember.computed.alias('block.data.details'),

  // ── Computed guards for {{#each}} ────────────────────────────────────────

  hasClients: Ember.computed('details.clients', function () {
    const clients = this.get('details.clients');
    return Array.isArray(clients) && clients.length > 0;
  }),

  hasDevices: Ember.computed('details.devices', function () {
    const devices = this.get('details.devices');
    return Array.isArray(devices) && devices.length > 0;
  }),

  // ── Lifecycle ────────────────────────────────────────────────────────────

  init() {
    this._super(...arguments);
    // Guard ensures idempotent re-renders don't reset state
    if (!this.get('block._state')) {
      this.set('block._state', {
        showClients: true,
        showDevices: true,
        // Per-client loading flags keyed by clientId
        isBlocking: {},
        // Per-client inline feedback messages keyed by clientId
        actionMessage: {}
      });
    }
  },

  // ── Actions ──────────────────────────────────────────────────────────────

  actions: {
    toggleSection(section) {
      const key = `block._state.show${section}`;
      this.set(key, !this.get(key));
    },

    /**
     * Send a BLOCK_CLIENT message for the given client result.
     * @param {Object} client - a member of details.clients[]
     */
    blockClient(client) {
      const clientId = client.clientId;
      const busyKey = `block._state.isBlocking.${clientId}`;
      const msgKey = `block._state.actionMessage.${clientId}`;

      this.set(busyKey, true);
      this.set(msgKey, '');

      this.sendIntegrationMessage({
        action: 'BLOCK_CLIENT',
        siteId: client.siteId,
        clientId
      })
        .then((response) => {
          if (response && response.success) {
            Ember.set(client, 'status', 'BLOCKED');
            this.set(msgKey, '✅ Client blocked');
          } else {
            const msg = (response && response.message) || 'Unknown error';
            this.set(msgKey, `⚠️ Failed: ${msg}`);
          }
        })
        .catch((err) => {
          this.set(msgKey, `⚠️ Error: ${err.message || err}`);
        })
        .finally(() => {
          this.set(busyKey, false);
        });
    },

    /**
     * Send a RECONNECT_CLIENT message for the given client result.
     * @param {Object} client - a member of details.clients[]
     */
    reconnectClient(client) {
      const clientId = client.clientId;
      const busyKey = `block._state.isBlocking.${clientId}`;
      const msgKey = `block._state.actionMessage.${clientId}`;

      this.set(busyKey, true);
      this.set(msgKey, '');

      this.sendIntegrationMessage({
        action: 'RECONNECT_CLIENT',
        siteId: client.siteId,
        clientId
      })
        .then((response) => {
          if (response && response.success) {
            Ember.set(client, 'status', 'CONNECTED');
            this.set(msgKey, '✅ Client reconnected');
          } else {
            const msg = (response && response.message) || 'Unknown error';
            this.set(msgKey, `⚠️ Failed: ${msg}`);
          }
        })
        .catch((err) => {
          this.set(msgKey, `⚠️ Error: ${err.message || err}`);
        })
        .finally(() => {
          this.set(busyKey, false);
        });
    }
  }
});
