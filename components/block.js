polarity.export = PolarityComponent.extend({
  details: Ember.computed.alias('block.data.details'),

  /**
   * Per-client loading state keyed by clientId.
   * @type {Object.<string, boolean>}
   */
  isBlockingClient: {},

  /**
   * Per-client inline feedback message keyed by clientId.
   * @type {Object.<string, string>}
   */
  blockActionMessage: {},

  actions: {
    /**
     * Send a BLOCK_CLIENT message for the given client result.
     * @param {Object} clientResult - a member of details.clients[]
     */
    blockClient(clientResult) {
      const clientId = clientResult.clientId;

      // Set loading state
      this.set(`isBlockingClient.${clientId}`, true);
      this.set(`blockActionMessage.${clientId}`, '');

      this.sendIntegrationMessage({
        action: 'BLOCK_CLIENT',
        siteId: clientResult.siteId,
        clientId
      })
        .then((response) => {
          if (response && response.success) {
            // Update the status directly in the block data so the UI refreshes
            Ember.set(clientResult, 'status', 'BLOCKED');
            this.set(`blockActionMessage.${clientId}`, '✅ Client blocked');
          } else {
            const msg = (response && response.message) || 'Unknown error';
            this.set(`blockActionMessage.${clientId}`, `⚠️ Failed: ${msg}`);
          }
        })
        .catch((err) => {
          this.set(`blockActionMessage.${clientId}`, `⚠️ Error: ${err.message || err}`);
        })
        .finally(() => {
          this.set(`isBlockingClient.${clientId}`, false);
        });
    },

    /**
     * Send a RECONNECT_CLIENT message for the given client result.
     * @param {Object} clientResult - a member of details.clients[]
     */
    reconnectClient(clientResult) {
      const clientId = clientResult.clientId;

      this.set(`isBlockingClient.${clientId}`, true);
      this.set(`blockActionMessage.${clientId}`, '');

      this.sendIntegrationMessage({
        action: 'RECONNECT_CLIENT',
        siteId: clientResult.siteId,
        clientId
      })
        .then((response) => {
          if (response && response.success) {
            Ember.set(clientResult, 'status', 'CONNECTED');
            this.set(`blockActionMessage.${clientId}`, '✅ Client reconnected');
          } else {
            const msg = (response && response.message) || 'Unknown error';
            this.set(`blockActionMessage.${clientId}`, `⚠️ Failed: ${msg}`);
          }
        })
        .catch((err) => {
          this.set(`blockActionMessage.${clientId}`, `⚠️ Error: ${err.message || err}`);
        })
        .finally(() => {
          this.set(`isBlockingClient.${clientId}`, false);
        });
    }
  }
});
