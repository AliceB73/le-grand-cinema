/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';

// Lecture seule (GET /api/health et /api/programme), uniquement vers la
// préproduction. Aucun verrou, checkout ou appel Stripe.
const baseUrl = (__ENV.BASE_URL || '').replace(/\/$/, '');
if (!/^https:\/\/api\.[0-9]{1,3}(?:-[0-9]{1,3}){3}\.nip\.io$/.test(baseUrl)) {
  throw new Error(
    'BASE_URL must be the https://api.<IP-avec-tirets>.nip.io origin.',
  );
}
if (__ENV.CONFIRM_PREPROD !== 'yes') {
  throw new Error(
    'Set CONFIRM_PREPROD=yes to confirm a run against the cluster.',
  );
}

const maxVus = Number(__ENV.MAX_VUS || '5');
if (!Number.isInteger(maxVus) || maxVus < 1 || maxVus > 1600) {
  throw new Error('MAX_VUS must be an integer from 1 to 1600.');
}
const stepMinutes = Number(__ENV.STEP_MINUTES || '1');
const holdMinutes = Number(__ENV.HOLD_MINUTES || '1');
if (!Number.isInteger(stepMinutes) || stepMinutes < 1 || stepMinutes > 10) {
  throw new Error('STEP_MINUTES must be an integer from 1 to 10.');
}
if (!Number.isInteger(holdMinutes) || holdMinutes < 1 || holdMinutes > 20) {
  throw new Error('HOLD_MINUTES must be an integer from 1 to 20.');
}

// Paliers à 25 %, 50 %, 75 % puis 100 % de MAX_VUS, comme tests-charge.md §5.
const targets = [0.25, 0.5, 0.75].map((ratio) =>
  Math.max(1, Math.round(maxVus * ratio)),
);

export const options = {
  stages: [
    ...targets.map((target) => ({ duration: `${stepMinutes}m`, target })),
    { duration: `${stepMinutes}m`, target: maxVus },
    { duration: `${holdMinutes}m`, target: maxVus },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
    'http_req_duration{endpoint:programme}': ['p(95)<2000'],
    'http_req_duration{endpoint:health}': ['p(95)<2000'],
    checks: ['rate>0.99'],
  },
};

function get(path, endpoint) {
  const response = http.get(`${baseUrl}${path}`, {
    redirects: 0,
    timeout: '10s',
    tags: { endpoint },
  });
  check(response, { [`${endpoint} returns 200`]: (r) => r.status === 200 });
}

export default function () {
  get('/api/programme', 'programme');
  sleep(1 + Math.random() * 2);
  get('/api/health', 'health');
  sleep(1 + Math.random() * 2);
}
