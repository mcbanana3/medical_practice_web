import { DateTime } from "luxon";
import { config } from "./config.mjs";
import { pool, query, SafeError } from "./db.mjs";

export async function databaseNow(connection = pool) {
  const [row] = await query(
    "SELECT UTC_TIMESTAMP(3) AS current_time_utc",
    [],
    connection
  );

  return DateTime.fromJSDate(row.current_time_utc, {
    zone: "utc"
  });
}

export async function bookingOptions(connection = pool) {
  return query(
    `SELECT
       b.location_id AS locationId,
       l.name AS locationName,
       b.provider_id AS providerId,
       p.name AS providerName,
       b.type_id AS typeId,
       t.name AS typeName,
       t.duration_minutes AS durationMinutes,
       b.is_demo AS demo
     FROM booking_options b
     JOIN locations l ON l.id=b.location_id
     JOIN providers p ON p.id=b.provider_id
     JOIN appointment_types t ON t.id=b.type_id
     WHERE b.enabled=1
       AND (
         (b.verified=1 AND b.is_demo=0)
         OR (?=1 AND b.is_demo=1)
       )
     ORDER BY l.id, t.id, p.id`,
    [config.fixtures ? 1 : 0],
    connection
  );
}

export async function findOption(input, connection = pool) {
  const options = await bookingOptions(connection);

  const option = options.find((item) =>
    item.locationId === input.locationId &&
    item.providerId === input.providerId &&
    item.typeId === input.typeId
  );

  if (!option) {
    throw new SafeError(
      404,
      "OPTION_UNAVAILABLE",
      "That appointment combination is unavailable."
    );
  }

  return option;
}

export function expandWindow(
  date,
  open,
  close,
  duration,
  zone
) {
  const day = DateTime.fromISO(date, { zone });

  if (!day.isValid || day.toISODate() !== date) {
    return [];
  }

  function minutes(time) {
    const [hours, mins] = time.slice(0, 5).split(":").map(Number);
    return hours * 60 + mins;
  }

  const first = minutes(open);
  const last = minutes(close);

  const closing = DateTime.fromISO(
    date + "T" + close.slice(0, 5),
    { zone }
  );

  if (!closing.isValid) return [];

  const closeMillis = Math.max(
    ...closing.getPossibleOffsets().map((value) =>
      value.toMillis()
    )
  );

  const slots = [];

  for (
    let minute = first;
    minute < last;
    minute += duration
  ) {
    const hour = Math.floor(minute / 60);
    const min = minute % 60;

    const expected =
      String(hour).padStart(2, "0") +
      ":" +
      String(min).padStart(2, "0");

    const local = DateTime.fromObject(
      {
        year: day.year,
        month: day.month,
        day: day.day,
        hour,
        minute: min
      },
      { zone }
    );

    // Skip nonexistent daylight-saving wall times.
    if (
      !local.isValid ||
      local.toFormat("HH:mm") !== expected
    ) {
      continue;
    }

    // Ambiguous daylight-saving times retain their distinct offsets.
    for (const start of local.getPossibleOffsets()) {
      const end = start.plus({ minutes: duration });

      if (end.toMillis() <= closeMillis) {
        slots.push({ start, end });
      }
    }
  }

  return slots;
}

export async function slotsFor(
  option,
  date,
  now,
  connection = pool
) {
  const localNow = now.setZone(config.zone);
  const day = DateTime.fromISO(date, {
    zone: config.zone
  });

  if (
    !day.isValid ||
    day.toISODate() !== date ||
    date < localNow.toISODate() ||
    date > localNow.plus({
      days: config.horizonDays
    }).toISODate()
  ) {
    throw new SafeError(
      400,
      "DATE_OUT_OF_RANGE",
      "Choose a date within the current request window."
    );
  }

  let windows = await query(
    `SELECT open_time, close_time
     FROM weekly_windows
     WHERE location_id=?
       AND provider_id=?
       AND weekday=?
     ORDER BY open_time`,
    [
      option.locationId,
      option.providerId,
      day.weekday
    ],
    connection
  );

  const exceptions = await query(
    `SELECT *
     FROM schedule_exceptions
     WHERE local_date=?
       AND (location_id IS NULL OR location_id=?)
       AND (provider_id IS NULL OR provider_id=?)
     ORDER BY
       ((location_id IS NOT NULL) +
        (provider_id IS NOT NULL)) DESC,
       id DESC`,
    [
      date,
      option.locationId,
      option.providerId
    ],
    connection
  );

  if (exceptions.some((item) => Boolean(item.closed))) {
    return [];
  }

  const replacement = exceptions.find((item) =>
    item.open_time && item.close_time
  );

  if (replacement) {
    windows = [replacement];
  }

  // IMPORTANT:
  // Every pending request blocks its interval.
  // Do not check expires_at here.
  // Approved appointments also continue to block their intervals.
  const occupied = await query(
    `SELECT starts_at, ends_at
     FROM appointment_requests
     WHERE provider_id=?
       AND starts_at < ?
       AND ends_at > ?
       AND status IN ('pending', 'approved')`,
    [
      option.providerId,
      day.plus({ days: 1 }).startOf("day").toUTC().toJSDate(),
      day.startOf("day").toUTC().toJSDate()
    ],
    connection
  );

  const minimum = now.plus({
    minutes: config.leadMinutes
  }).toMillis();

  const available = new Map();

  for (const window of windows) {
    const candidates = expandWindow(
      date,
      window.open_time,
      window.close_time,
      option.durationMinutes,
      config.zone
    );

    for (const slot of candidates) {
      const start = slot.start.toMillis();
      const end = slot.end.toMillis();

      if (start < minimum) continue;

      const overlaps = occupied.some((item) =>
        item.starts_at.getTime() < end &&
        item.ends_at.getTime() > start
      );

      if (overlaps) continue;

      const startsAt = slot.start.toUTC().toISO({
        suppressMilliseconds: true
      });

      available.set(startsAt, {
        startsAt,
        endsAt: slot.end.toUTC().toISO({
          suppressMilliseconds: true
        }),
        label: slot.start.toFormat("h:mm a 'UTC'ZZ")
      });
    }
  }

  return [...available.values()].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt)
  );
}