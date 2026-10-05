class SanctionsRules {
  static check(userName) {
    if (!userName) return [];

    const normalized = userName.toLowerCase().trim();

    if (SanctionsRules.BLOCKED_NAMES.has(normalized)) {
      return ['sanctioned_individual'];
    }

    return [];
  }
}

SanctionsRules.BLOCKED_NAMES = new Set(['kim jong un', 'osama bin laden', 'el chapo']);

module.exports = SanctionsRules;
