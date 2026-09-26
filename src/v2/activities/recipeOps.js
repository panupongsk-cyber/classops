// Browser preview for recipe_pipeline parts. It runs a learner's recipe on the level input so they
// can see each step's output while building it. It holds no targets: the server runs the submitted
// recipe itself (server/src/activities/engine.ts, runRecipe) and scores that.
//
// Every operation must produce exactly the server's output, character for character. The private
// item bank's parity test imports this file and compares it with the server engine and with the
// source game on an adversarial recipe corpus. SHA-256 and AES use WebCrypto, so this is async.

export const RECIPE_MAX_STEPS = 10
export const RECIPE_MAX_PARAM = 256
export const RECIPE_MAX_DATA = 65536

const PARAMS = { fromBase64: [], toBase64: [], fromHex: [], toHex: [], xor: ['key'], sha256: [], aesDecrypt: ['key', 'iv'] }

function fromHex(hexStr) {
  const cleanHex = hexStr.replace(/(0x|[\s,;:]+)/g, '')
  if (cleanHex.length % 2 !== 0) return '[ERROR: Hex length must be even]'
  try {
    let str = ''
    for (let i = 0; i < cleanHex.length; i += 2) {
      str += String.fromCharCode(parseInt(cleanHex.substring(i, i + 2), 16))
    }
    return str
  } catch {
    return '[ERROR: Invalid Hex input]'
  }
}

function toHex(str) {
  let hex = ''
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i).toString(16)
    hex += (code.length === 1 ? '0' + code : code) + ' '
  }
  return hex.trim()
}

function fromBase64(base64Str) {
  try {
    return atob(base64Str.trim().replace(/\s+/g, ''))
  } catch {
    return '[ERROR: Invalid Base64 input]'
  }
}

function toBase64(str) {
  try {
    return btoa(str)
  } catch {
    return '[ERROR: Cannot encode Base64]'
  }
}

function xor(str, key) {
  if (!key) return str
  let keyBytes = []
  if (key.startsWith('0x')) {
    const hexVal = parseInt(key.slice(2), 16)
    keyBytes = isNaN(hexVal) ? [] : [hexVal]
  } else {
    for (let i = 0; i < key.length; i++) keyBytes.push(key.charCodeAt(i))
  }
  if (keyBytes.length === 0) return str
  let result = ''
  for (let i = 0; i < str.length; i++) {
    result += String.fromCharCode(str.charCodeAt(i) ^ keyBytes[i % keyBytes.length])
  }
  return result
}

async function sha256(str) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function aesDecrypt(ciphertextBase64, keyStr, ivStr) {
  const encoder = new TextEncoder()
  const keyBytes = encoder.encode(keyStr)
  const ivBytes = encoder.encode(ivStr)
  if (keyBytes.byteLength !== 32) {
    return `[ERROR: AES-256-CBC key must be exactly 32 UTF-8 bytes; received ${keyBytes.byteLength}]`
  }
  if (ivBytes.byteLength !== 16) {
    return `[ERROR: AES-CBC IV must be exactly 16 UTF-8 bytes; received ${ivBytes.byteLength}]`
  }
  try {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC', length: 256 }, false, ['decrypt'])
    const cipherBinary = fromBase64(ciphertextBase64)
    const cipherBytes = new Uint8Array(cipherBinary.length)
    for (let i = 0; i < cipherBinary.length; i++) cipherBytes[i] = cipherBinary.charCodeAt(i)
    const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, key, cipherBytes)
    return new TextDecoder().decode(plain)
  } catch {
    return '[ERROR: Decryption Failed. Check Key/IV parameters]'
  }
}

const FNS = { fromHex, toHex, fromBase64, toBase64, xor, sha256, aesDecrypt }

/**
 * Run `steps` ([{op, params}]) on `input`, stopping at the first output that starts with
 * "[ERROR", as the game does. Returns every step's output so the player can show them.
 */
export async function runRecipe(input, steps) {
  const outputs = []
  let data = input
  for (const step of steps) {
    data = await FNS[step.op](data, ...PARAMS[step.op].map((k) => step.params[k]))
    if (data.length > RECIPE_MAX_DATA) data = `[ERROR: Step output exceeds ${RECIPE_MAX_DATA} characters]`
    outputs.push(data)
    if (data.startsWith('[ERROR')) break
  }
  return { output: data, outputs }
}
