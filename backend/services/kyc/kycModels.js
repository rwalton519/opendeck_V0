// Converted from services/kyc/kyc_models.py - a tiny plain data holder class
// (distinct from app.models.kyc_models.KYCRecord, the actual Sequelize model
// used by KYCManager in kycManager.js).

class KYCRecord {
  constructor(userId, tier, status) {
    this.user_id = userId;
    this.tier = tier;
    this.status = status;
  }
}

module.exports = KYCRecord;
