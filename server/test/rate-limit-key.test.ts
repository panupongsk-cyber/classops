import assert from "node:assert/strict";
import test from "node:test";

import { clientAddressBucket } from "../src/rate-limit-key.js";

test("anonymous buckets: IPv4 as is, IPv6 by /64, IPv4-mapped IPv6 as its IPv4", () => {
  assert.equal(clientAddressBucket("198.51.100.7"), "198.51.100.7");
  assert.equal(clientAddressBucket("::ffff:198.51.100.7"), "198.51.100.7");
  // Two addresses in one /64 share a bucket; the next /64 does not.
  assert.equal(clientAddressBucket("2405:9800:b510:bd21:6b:42bb:503d:45db"), "2405:9800:b510:bd21::/64");
  assert.equal(clientAddressBucket("2405:9800:b510:bd21::1"), "2405:9800:b510:bd21::/64");
  assert.equal(clientAddressBucket("2405:9800:B510:BD21:0:0:0:ffff"), "2405:9800:b510:bd21::/64");
  assert.notEqual(clientAddressBucket("2405:9800:b510:bd22::1"), clientAddressBucket("2405:9800:b510:bd21::1"));
  // `::` expansion at the front, in the prefix, and with a zone id; leading zeros normalized.
  assert.equal(clientAddressBucket("::1"), "0:0:0:0::/64");
  assert.equal(clientAddressBucket("2001:db8::7"), "2001:db8:0:0::/64");
  assert.equal(clientAddressBucket("2001:0db8:0000:0042::7"), "2001:db8:0:42::/64");
  assert.equal(clientAddressBucket("fe80::1%eth0"), "fe80:0:0:0::/64");
  assert.equal(clientAddressBucket("64:ff9b::198.51.100.7"), "64:ff9b:0:0::/64");
  assert.equal(clientAddressBucket("not-an-ip"), "not-an-ip");
});
