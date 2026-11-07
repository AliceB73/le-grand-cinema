/* global __ENV */
import http from 'k6/http';
import { check, sleep } from 'k6';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const localUrl =
  /^http:\/\/(?:localhost|127\.0\.0\.1)(?::([1-9]\d{0,4}))?$/i.exec(baseUrl);
if (!localUrl || (localUrl[1] && Number(localUrl[1]) > 65535)) {
  throw new Error('BASE_URL must be an HTTP localhost or 127.0.0.1 origin.');
}

const duration = __ENV.DURATION_SECONDS || '10';
if (!/^(?:[1-9]|[12]\d|30)$/.test(duration)) {
  throw new Error('DURATION_SECONDS must be an integer from 1 to 30.');
}

const includeSeats = __ENV.INCLUDE_SEATS || 'false';
if (includeSeats !== 'true' && includeSeats !== 'false') {
  throw new Error('INCLUDE_SEATS must be true or false.');
}

const holdTest = __ENV.HOLD_TEST || 'false';
if (holdTest !== 'true' && holdTest !== 'false') {
  throw new Error('HOLD_TEST must be true or false.');
}

const showtimeId = __ENV.SHOWTIME_ID || '';
const sessionToken = __ENV.SEAT_SESSION_TOKEN || '';
const seatId = __ENV.SEAT_ID || '';
if (includeSeats === 'true' || holdTest === 'true') {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(showtimeId)) {
    throw new Error('SHOWTIME_ID must identify an existing showtime.');
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      sessionToken,
    )
  ) {
    throw new Error('SEAT_SESSION_TOKEN must be a valid UUID.');
  }
}
if (holdTest === 'true' && !/^[a-zA-Z0-9_-]{1,120}$/.test(seatId)) {
  throw new Error('SEAT_ID must identify one dedicated test seat.');
}

const thresholds = {
  checks: ['rate==1'],
  'http_req_duration{endpoint:health}': ['p(95)<2000'],
  'http_req_duration{endpoint:programme}': ['p(95)<2000'],
};
if (includeSeats === 'true' || holdTest === 'true') {
  thresholds['http_req_duration{endpoint:seats}'] = ['p(95)<2000'];
}
if (holdTest === 'true') {
  thresholds['http_req_duration{endpoint:hold}'] = ['p(95)<2000'];
  thresholds['http_req_duration{endpoint:release}'] = ['p(95)<2000'];
}

export const options =
  holdTest === 'true'
    ? { vus: 1, iterations: 1, thresholds }
    : { vus: 1, duration: `${duration}s`, thresholds };

function getAndCheck(path, endpoint, headers = {}) {
  const response = http.get(`${baseUrl}${path}`, {
    headers,
    redirects: 0,
    timeout: '5s',
    tags: { endpoint },
  });
  check(response, {
    [`${endpoint} returns 200`]: (result) => result.status === 200,
  });
  return response;
}

function runHoldCycle() {
  const path = `/api/showtimes/${showtimeId}/seats`;
  const holdsPath = `/api/showtimes/${showtimeId}/seats/holds`;
  const headers = { 'x-seat-session-token': sessionToken };
  let holdAttempted = false;

  try {
    const seatMapResponse = http.get(`${baseUrl}${path}`, {
      headers,
      redirects: 0,
      timeout: '5s',
      tags: { endpoint: 'seats' },
    });
    const seatMapOk = check(seatMapResponse, {
      'seat map returns 200 before hold': (response) => response.status === 200,
    });
    if (!seatMapOk) return;

    const seat = seatMapResponse
      .json()
      .seats.find((item) => item.id === seatId);
    if (
      !check(seat, {
        'dedicated test seat is available': (item) =>
          item?.status === 'available',
      })
    ) {
      return;
    }

    holdAttempted = true;
    const holdResponse = http.post(
      `${baseUrl}${holdsPath}`,
      JSON.stringify({ seatIds: [seatId] }),
      {
        headers: { ...headers, 'Content-Type': 'application/json' },
        redirects: 0,
        timeout: '5s',
        tags: { endpoint: 'hold' },
      },
    );
    const holdCreated = check(holdResponse, {
      'hold returns 201': (response) => response.status === 201,
      'hold contains only the requested seat': (response) =>
        response.status === 201 &&
        Array.isArray(response.json().heldSeatIds) &&
        response.json().heldSeatIds.length === 1 &&
        response.json().heldSeatIds[0] === seatId,
    });
    if (!holdCreated) return;

    const heldMapResponse = http.get(`${baseUrl}${path}`, {
      headers,
      redirects: 0,
      timeout: '5s',
      tags: { endpoint: 'seats' },
    });
    check(heldMapResponse, {
      'seat map confirms the test seat is held by this session': (response) => {
        if (response.status !== 200) return false;
        const heldSeat = response
          .json()
          .seats.find((item) => item.id === seatId);
        return (
          heldSeat?.status === 'held' && heldSeat.heldByCurrentSession === true
        );
      },
    });
  } finally {
    if (holdAttempted) {
      const releaseResponse = http.del(
        `${baseUrl}${holdsPath}`,
        JSON.stringify({ seatIds: [seatId] }),
        {
          headers: { ...headers, 'Content-Type': 'application/json' },
          redirects: 0,
          timeout: '5s',
          tags: { endpoint: 'release' },
        },
      );
      check(releaseResponse, {
        'release returns 200': (response) => response.status === 200,
      });

      const releasedMapResponse = http.get(`${baseUrl}${path}`, {
        headers,
        redirects: 0,
        timeout: '5s',
        tags: { endpoint: 'seats' },
      });
      check(releasedMapResponse, {
        'seat map confirms the test seat is available after release': (
          response,
        ) => {
          if (response.status !== 200) return false;
          const releasedSeat = response
            .json()
            .seats.find((item) => item.id === seatId);
          return releasedSeat?.status === 'available';
        },
      });
    }
  }
}

export default function () {
  getAndCheck('/api/health', 'health');
  getAndCheck('/api/programme', 'programme');
  if (holdTest === 'true') {
    runHoldCycle();
  } else if (includeSeats === 'true') {
    getAndCheck(`/api/showtimes/${showtimeId}/seats`, 'seats', {
      'x-seat-session-token': sessionToken,
    });
  }
  sleep(1);
}
