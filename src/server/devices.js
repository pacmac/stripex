// Where Peter's own components live.
//
// ONE FILE, NOT A DIRECTORY. A JST family is fourteen entries and nobody wants
// fourteen files to see what has been customised — and the whole value of this
// file is being able to read what has been added or changed at a glance. Boards
// get a file each because a board is a document you open; the catalogue is one
// list you edit.
//
// It holds ONLY additions and overrides. The built-ins stay in src/parts and
// stay the defaults, so a fresh install is a complete catalogue with no file
// here at all — and deleting this file returns everything to stock rather than
// emptying the palette.

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { validateDevice } from '../parts/devices.js';

export class DeviceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Read at call time, like boardsDirFor, so a test can point it somewhere else
// without the module having been imported in the right order.
export function devicesFileFor(root) {
  return process.env.STRIPEX_DEVICES_FILE || path.join(root, 'devices.json');
}

// Everything stored, or an empty list. A file that cannot be read is REPORTED
// rather than silently treated as empty: an unreadable catalogue that looks like
// an empty one would quietly revert every component Peter had defined.
export function read(file) {
  if (!existsSync(file)) return [];
  let text;
  try { text = readFileSync(file, 'utf8'); }
  catch (e) { throw new DeviceError('unreadable', `${file} could not be read: ${e.message}`); }
  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new DeviceError('unreadable', `${file} is not readable JSON: ${e.message}`); }
  const list = Array.isArray(data) ? data : data?.devices;
  if (!Array.isArray(list)) throw new DeviceError('unreadable', `${file} does not hold a list of devices`);
  return list;
}

export function write(file, devices) {
  for (const d of devices) {
    const bad = validateDevice(d);
    if (bad) throw new DeviceError('invalid', bad);
  }
  const dir = path.dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(devices, null, 2)}\n`);
  return devices;
}

// Add or replace one, by id.
export function put(file, device) {
  const bad = validateDevice(device);
  if (bad) throw new DeviceError('invalid', bad);
  const list = read(file).filter((d) => d.id !== device.id);
  list.push(device);
  list.sort((a, b) => a.id.localeCompare(b.id));
  return write(file, list);
}

// Drop an override. A built-in returns to stock; a custom device goes.
export function remove(file, id) {
  const list = read(file);
  if (!list.some((d) => d.id === id)) {
    throw new DeviceError('no-such-device', `nothing is stored for ${JSON.stringify(id)}`);
  }
  const next = list.filter((d) => d.id !== id);
  if (!next.length && existsSync(file)) {
    // The last override going means back to a stock catalogue, and an empty file
    // says that less clearly than no file.
    unlinkSync(file);
    return [];
  }
  return write(file, next);
}
