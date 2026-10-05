const assert = require('node:assert/strict');
const test = require('node:test');

const KYCManager = require('../services/kyc/kycManager');
const LimitChecker = require('../services/compliance/limits');
const { hashPassword } = require('../auth/hashing');
const Admin = require('../models/admin');

test('KYCManager.getLimits returns configured limits and LimitChecker uses them', async () => {
  const previous = process.env.KYC_DEPOSIT_LIMITS_JSON;
  process.env.KYC_DEPOSIT_LIMITS_JSON = JSON.stringify({
    unverified: { deposit: 0 },
    verified: { deposit: 5000 },
  });

  try {
    assert.deepEqual(KYCManager.getLimits('verified'), { deposit: 5000 });
    const checker = new LimitChecker();
    assert.equal(await checker.checkDeposit({ kyc_tier: 'verified' }, 5000), true);
    assert.equal(await checker.checkDeposit({ kyc_tier: 'verified' }, 5000.01), false);
    assert.equal(await checker.checkDeposit({ kyc_tier: 'unverified' }, 1), false);
  } finally {
    if (previous === undefined) delete process.env.KYC_DEPOSIT_LIMITS_JSON;
    else process.env.KYC_DEPOSIT_LIMITS_JSON = previous;
  }
});

test('KYCManager.getLimits fails closed when policy is missing', () => {
  const previous = process.env.KYC_DEPOSIT_LIMITS_JSON;
  delete process.env.KYC_DEPOSIT_LIMITS_JSON;
  try {
    assert.throws(() => KYCManager.getLimits('verified'), /KYC_DEPOSIT_LIMITS_JSON is not configured/);
  } finally {
    if (previous !== undefined) process.env.KYC_DEPOSIT_LIMITS_JSON = previous;
  }
});

test('admin password hashing remains compatible with the Admin model', () => {
  const admin = Admin.build({ password_hash: hashPassword('old-password-123') });
  assert.equal(admin.checkPassword('old-password-123'), true);
  admin.setPassword('new-password-123');
  assert.equal(admin.checkPassword('old-password-123'), false);
  assert.equal(admin.checkPassword('new-password-123'), true);
});
