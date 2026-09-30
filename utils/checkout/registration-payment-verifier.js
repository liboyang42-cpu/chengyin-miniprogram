'use strict';

const { createPaymentVerifier } = require('./payment-verifier.js');

function classifyRegistrationStatus(res) {
  if (!res || typeof res !== 'object') return 'unknown';
  if (Number(res.paymentStatus) === 2 || Number(res.registrationStatus) === 2) return 'success';
  if ([3, 4].indexOf(Number(res.paymentStatus)) >= 0 || Number(res.registrationStatus) === 3) return 'failed';
  return 'pending';
}

function createRegistrationPaymentVerifier(app, options) {
  options = options || {};
  return createPaymentVerifier({
    requestStatus(ref, requestOptions, cb) {
      return app.sendRequest({
        url: '/api/registration/info',
        data: { id: ref.registrationId },
        method: 'POST',
        hideLoading: true,
        autoErrorToast: false,
        timeout: requestOptions.timeout,
        success(res) {
          if ((res.code == '200' || res.code == 200) && res.data) cb(res.data);
          else cb(null);
        },
        successStatusAbnormal() { cb(null); },
        fail() { cb(null); }
      });
    },
    classify: classifyRegistrationStatus,
    perRequestTimeoutMs: options.perRequestTimeoutMs || 5000,
    totalDeadlineMs: options.totalDeadlineMs || 20000,
    intervalMs: options.intervalMs || 1500,
    now: options.now,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer
  });
}

module.exports = {
  classifyRegistrationStatus,
  createRegistrationPaymentVerifier
};
