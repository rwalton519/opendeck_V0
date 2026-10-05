class AuditLogger {
  // eslint-disable-next-line class-methods-use-this
  log(eventType, data) {
    console.log(`[AUDIT] ${eventType}: ${JSON.stringify(data)}`);
  }
}

module.exports = AuditLogger;
