/*
 * QR Code generator — minimal byte-mode encoder.
 *
 * Vendored single-file implementation based on Project Nayuki's QR Code
 * Generator design (https://www.nayuki.io/page/qr-code-generator-library),
 * MIT licensed. We only need byte mode for LPA: activation strings, so we've
 * dropped numeric/alphanumeric/kanji modes and segment merging logic.
 *
 * Public API:
 *   QRCode.encode(text, ecLevel = 'M') -> { size: number, modules: boolean[][] }
 *
 * `modules[y][x]` is true if the pixel at (x, y) is dark.
 *
 * Supports QR versions 1–40 with error-correction levels L (~7%), M (~15%),
 * Q (~25%), and H (~30%). Throws on data that exceeds version-40 capacity.
 *
 * No external dependencies. CSP-friendly (script-src 'self').
 */
(function (global) {
  'use strict';

  // ---------- Capacity & EC tables (ISO/IEC 18004 §7.5.1) ------------------

  // ECC_CODEWORDS_PER_BLOCK[ecl][version]
  // ecl index: 0=L, 1=M, 2=Q, 3=H. version index: 1..40 (slot 0 unused).
  var ECC_CODEWORDS_PER_BLOCK = [
    // 0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40
    [-1,  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];

  // NUM_ERROR_CORRECTION_BLOCKS[ecl][version]
  var NUM_ERROR_CORRECTION_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4,  4,  4,  4,  4,  6,  6,  6,  6,  7,  8,  8,  9,  9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8,  8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  // Alignment-pattern centre row/column positions per version (§E.1).
  // Empty for v1; first&last entries are 6 and 4*v+10. ISO defines a recipe.
  function getAlignmentPositions(ver) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2;
    var step = (ver === 32) ? 26
      : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var result = [6];
    for (var pos = ver * 4 + 10; result.length < n; pos -= step) {
      result.splice(1, 0, pos);
    }
    return result;
  }

  // ---------- GF(2^8) arithmetic for Reed-Solomon -------------------------

  function gfMul(a, b) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = ((z << 1) ^ ((z >>> 7) * 0x11D)) & 0xFF;
      z ^= ((b >>> i) & 1) * a;
      z &= 0xFF;
    }
    return z;
  }

  // Compute the RS generator polynomial of given degree.
  function rsGenerator(degree) {
    var coeffs = new Uint8Array(degree);
    coeffs[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) {
        coeffs[j] = gfMul(coeffs[j], root);
        if (j + 1 < degree) coeffs[j] ^= coeffs[j + 1];
      }
      root = gfMul(root, 2);
    }
    return coeffs;
  }

  // Compute the RS error-correction codewords for `data` using `gen`.
  function rsRemainder(data, gen) {
    var result = new Uint8Array(gen.length);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (var j = 0; j < gen.length; j++) {
        result[j] ^= gfMul(gen[j], factor);
      }
    }
    return result;
  }

  // ---------- Capacity helpers --------------------------------------------

  function getNumRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36; // version info modules
    }
    return result;
  }

  // Number of 8-bit data codewords (excludes EC codewords).
  function getNumDataCodewords(ver, ecl) {
    return Math.floor(getNumRawDataModules(ver) / 8)
      - ECC_CODEWORDS_PER_BLOCK[ecl][ver]
      * NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
  }

  // Bit length of the byte-mode character-count indicator at given version.
  function byteModeCharCountBits(ver) {
    return ver < 10 ? 8 : 16;
  }

  // ---------- Bit stream builder ------------------------------------------

  function appendBits(bits, val, len) {
    for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  }

  // Encode a UTF-8 byte array as a bit stream including mode + length + data.
  function buildBitStream(bytes, ver) {
    var bits = [];
    appendBits(bits, 0x4, 4); // byte mode indicator
    appendBits(bits, bytes.length, byteModeCharCountBits(ver));
    for (var i = 0; i < bytes.length; i++) appendBits(bits, bytes[i], 8);
    return bits;
  }

  // ---------- Codeword assembly + RS interleaving --------------------------

  function makeFinalCodewords(bits, ver, ecl) {
    var capBits = getNumDataCodewords(ver, ecl) * 8;
    if (bits.length > capBits) throw new Error('data too long for version');

    // Terminator (up to 4 zero bits)
    for (var i = 0; i < 4 && bits.length < capBits; i++) bits.push(0);

    // Pad to byte boundary
    while (bits.length % 8 !== 0) bits.push(0);

    // Pad with alternating 0xEC / 0x11
    for (var pad = 0xEC; bits.length < capBits; pad ^= 0xFD) {
      appendBits(bits, pad, 8);
    }

    // Pack bits into bytes
    var dataCodewords = new Uint8Array(bits.length / 8);
    for (var i = 0; i < bits.length; i++) {
      dataCodewords[i >>> 3] |= bits[i] << (7 - (i & 7));
    }

    // Split into blocks, compute EC for each, then interleave.
    var numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
    var totalEcc  = ECC_CODEWORDS_PER_BLOCK[ecl][ver] * numBlocks;
    var blockEcLen = ECC_CODEWORDS_PER_BLOCK[ecl][ver];
    var rawCwTotal = Math.floor(getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - rawCwTotal % numBlocks;
    var shortBlockLen  = Math.floor(rawCwTotal / numBlocks);

    var blocks = [];
    var gen = rsGenerator(blockEcLen);
    var k = 0;
    for (var b = 0; b < numBlocks; b++) {
      var dataLen = shortBlockLen - blockEcLen + (b < numShortBlocks ? 0 : 1);
      var dat = dataCodewords.slice(k, k + dataLen);
      k += dataLen;
      var ec = rsRemainder(dat, gen);
      var blk = new Uint8Array(dat.length + ec.length);
      blk.set(dat, 0);
      blk.set(ec, dat.length);
      blocks.push(blk);
    }

    // Interleave: column-by-column for data, then EC.
    var result = new Uint8Array(rawCwTotal);
    var idx = 0;
    var maxDataLen = shortBlockLen - blockEcLen + 1;
    for (var col = 0; col < maxDataLen; col++) {
      for (var b = 0; b < blocks.length; b++) {
        // Skip the last data column for short blocks
        if (col === maxDataLen - 1 && b < numShortBlocks) continue;
        result[idx++] = blocks[b][col];
      }
    }
    for (var col = 0; col < blockEcLen; col++) {
      var ecOffset = blocks[0].length - blockEcLen;
      for (var b = 0; b < blocks.length; b++) {
        // EC offset depends on block size
        var off = blocks[b].length - blockEcLen + col;
        result[idx++] = blocks[b][off];
      }
    }
    return result;
  }

  // ---------- Module matrix construction ----------------------------------

  function makeMatrix(ver, ecl, codewords) {
    var size = ver * 4 + 17;
    var modules  = new Array(size);
    var isFunc   = new Array(size); // marks function-pattern cells
    for (var y = 0; y < size; y++) {
      modules[y]  = new Uint8Array(size);
      isFunc[y]   = new Uint8Array(size);
    }

    function setFunc(x, y, dark) {
      modules[y][x] = dark ? 1 : 0;
      isFunc[y][x]  = 1;
    }

    // --- Finder patterns (top-left, top-right, bottom-left)
    function drawFinder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var x = cx + dx, y = cy + dy;
          if (x < 0 || x >= size || y < 0 || y >= size) continue;
          var d = Math.max(Math.abs(dx), Math.abs(dy));
          setFunc(x, y, d !== 2 && d !== 4);
        }
      }
    }
    drawFinder(3, 3);
    drawFinder(size - 4, 3);
    drawFinder(3, size - 4);

    // --- Timing patterns
    for (var i = 8; i < size - 8; i++) {
      setFunc(6, i, i % 2 === 0);
      setFunc(i, 6, i % 2 === 0);
    }

    // --- Alignment patterns
    var ap = getAlignmentPositions(ver);
    for (var i = 0; i < ap.length; i++) {
      for (var j = 0; j < ap.length; j++) {
        // Skip overlap with finders
        if ((i === 0 && j === 0) ||
            (i === 0 && j === ap.length - 1) ||
            (i === ap.length - 1 && j === 0)) continue;
        var cx = ap[j], cy = ap[i];
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) {
            var d = Math.max(Math.abs(dx), Math.abs(dy));
            setFunc(cx + dx, cy + dy, d !== 1);
          }
        }
      }
    }

    // --- Reserve format-info area (filled later with chosen mask)
    for (var i = 0; i <= 8; i++) {
      if (!isFunc[8][i]) setFunc(i, 8, false);
      if (!isFunc[i][8]) setFunc(8, i, false);
    }
    setFunc(8, size - 8, true); // dark module
    for (var i = 0; i < 8; i++) {
      setFunc(size - 1 - i, 8, false);
      setFunc(8, size - 1 - i, false);
    }

    // --- Reserve version-info area (v >= 7)
    if (ver >= 7) {
      for (var i = 0; i < 6; i++) {
        for (var j = 0; j < 3; j++) {
          setFunc(i, size - 11 + j, false);
          setFunc(size - 11 + j, i, false);
        }
      }
    }

    // --- Place data bits (zigzag, skipping function modules)
    var bitIdx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip vertical timing column
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!isFunc[y][x] && bitIdx < codewords.length * 8) {
            modules[y][x] = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
            bitIdx++;
          }
        }
      }
    }

    return { modules: modules, isFunc: isFunc, size: size };
  }

  // ---------- Masking -----------------------------------------------------

  function applyMask(modules, isFunc, mask) {
    var size = modules.length;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (isFunc[y][x]) continue;
        var invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0; break;
          case 5: invert = (x * y) % 2 + (x * y) % 3 === 0; break;
          case 6: invert = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
          case 7: invert = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break;
        }
        if (invert) modules[y][x] ^= 1;
      }
    }
  }

  function drawFormatBits(modules, isFunc, ecl, mask) {
    // ecl mapping in format info: L=01, M=00, Q=11, H=10
    var fmtEclBits = [1, 0, 3, 2][ecl];
    var data = (fmtEclBits << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    var size = modules.length;

    function set(x, y, b) {
      modules[y][x] = b;
      isFunc[y][x]  = 1;
    }

    // First copy
    for (var i = 0; i <= 5; i++) set(8, i, (bits >>> i) & 1);
    set(8, 7, (bits >>> 6) & 1);
    set(8, 8, (bits >>> 7) & 1);
    set(7, 8, (bits >>> 8) & 1);
    for (var i = 9; i < 15; i++) set(14 - i, 8, (bits >>> i) & 1);

    // Second copy
    for (var i = 0; i < 8; i++) set(size - 1 - i, 8, (bits >>> i) & 1);
    for (var i = 8; i < 15; i++) set(8, size - 15 + i, (bits >>> i) & 1);
    set(8, size - 8, 1);
  }

  function drawVersionBits(modules, isFunc, ver) {
    if (ver < 7) return;
    var rem = ver;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (ver << 12) | rem;
    var size = modules.length;
    for (var i = 0; i < 18; i++) {
      var b = (bits >>> i) & 1;
      var a = size - 11 + i % 3;
      var bb = Math.floor(i / 3);
      modules[bb][a]  = b;  isFunc[bb][a]  = 1;
      modules[a][bb]  = b;  isFunc[a][bb]  = 1;
    }
  }

  function maskPenalty(modules) {
    var size = modules.length;
    var penalty = 0;

    // Rule 1: rows/columns with 5+ same-color in a row
    for (var y = 0; y < size; y++) {
      var runColor = -1, runLen = 0;
      for (var x = 0; x < size; x++) {
        if (modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) penalty += 3;
          else if (runLen > 5) penalty++;
        } else { runColor = modules[y][x]; runLen = 1; }
      }
    }
    for (var x = 0; x < size; x++) {
      var runColor = -1, runLen = 0;
      for (var y = 0; y < size; y++) {
        if (modules[y][x] === runColor) {
          runLen++;
          if (runLen === 5) penalty += 3;
          else if (runLen > 5) penalty++;
        } else { runColor = modules[y][x]; runLen = 1; }
      }
    }

    // Rule 2: 2x2 blocks of same color
    for (var y = 0; y < size - 1; y++) {
      for (var x = 0; x < size - 1; x++) {
        var c = modules[y][x];
        if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
          penalty += 3;
        }
      }
    }

    // Rule 3: finder-like 1011101 patterns
    var pattern = [1, 0, 1, 1, 1, 0, 1];
    for (var y = 0; y < size; y++) {
      for (var x = 0; x <= size - 7; x++) {
        var match = true;
        for (var i = 0; i < 7; i++) if (modules[y][x + i] !== pattern[i]) { match = false; break; }
        if (match) penalty += 40;
      }
    }
    for (var x = 0; x < size; x++) {
      for (var y = 0; y <= size - 7; y++) {
        var match = true;
        for (var i = 0; i < 7; i++) if (modules[y + i][x] !== pattern[i]) { match = false; break; }
        if (match) penalty += 40;
      }
    }

    // Rule 4: dark module ratio
    var dark = 0;
    for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) dark += modules[y][x];
    var pct = dark * 20 / (size * size);
    penalty += Math.abs(Math.floor(pct) - 10) * 10;

    return penalty;
  }

  // ---------- UTF-8 encoding ---------------------------------------------

  function utf8Encode(text) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >>> 6), 0x80 | (c & 0x3F)); }
      else if (c < 0xD800 || c >= 0xE000) { out.push(0xE0 | (c >>> 12), 0x80 | ((c >>> 6) & 0x3F), 0x80 | (c & 0x3F)); }
      else {
        // Surrogate pair
        i++;
        var c2 = text.charCodeAt(i);
        var cp = 0x10000 + ((c & 0x3FF) << 10) + (c2 & 0x3FF);
        out.push(0xF0 | (cp >>> 18),
                 0x80 | ((cp >>> 12) & 0x3F),
                 0x80 | ((cp >>> 6) & 0x3F),
                 0x80 | (cp & 0x3F));
      }
    }
    return out;
  }

  // ---------- Public encode() --------------------------------------------

  var ECL_MAP = { L: 0, M: 1, Q: 2, H: 3 };

  function encode(text, level) {
    var ecl = ECL_MAP[(level || 'M').toUpperCase()];
    if (ecl === undefined) ecl = 1;
    var bytes = utf8Encode(text);

    // Pick smallest version that fits
    var ver = -1;
    for (var v = 1; v <= 40; v++) {
      var capBits = getNumDataCodewords(v, ecl) * 8;
      var dataBits = 4 + byteModeCharCountBits(v) + bytes.length * 8;
      if (dataBits <= capBits) { ver = v; break; }
    }
    if (ver === -1) throw new Error('data too long even for version 40 at this EC level');

    var bits = buildBitStream(bytes, ver);
    var codewords = makeFinalCodewords(bits, ver, ecl);
    var built = makeMatrix(ver, ecl, codewords);

    // Pick best mask by penalty
    var bestMask = 0, bestPenalty = Infinity;
    var savedModules = built.modules.map(function (r) { return new Uint8Array(r); });
    var savedIsFunc  = built.isFunc.map(function (r) { return new Uint8Array(r); });
    for (var m = 0; m < 8; m++) {
      // restore
      built.modules = savedModules.map(function (r) { return new Uint8Array(r); });
      built.isFunc  = savedIsFunc.map(function (r) { return new Uint8Array(r); });
      drawFormatBits(built.modules, built.isFunc, ecl, m);
      drawVersionBits(built.modules, built.isFunc, ver);
      applyMask(built.modules, built.isFunc, m);
      var p = maskPenalty(built.modules);
      if (p < bestPenalty) { bestPenalty = p; bestMask = m; }
    }

    // Re-render with best mask
    built.modules = savedModules.map(function (r) { return new Uint8Array(r); });
    built.isFunc  = savedIsFunc.map(function (r) { return new Uint8Array(r); });
    drawFormatBits(built.modules, built.isFunc, ecl, bestMask);
    drawVersionBits(built.modules, built.isFunc, ver);
    applyMask(built.modules, built.isFunc, bestMask);

    // Convert Uint8Array rows to boolean[][]
    var size = built.size;
    var out = new Array(size);
    for (var y = 0; y < size; y++) {
      var row = new Array(size);
      for (var x = 0; x < size; x++) row[x] = built.modules[y][x] === 1;
      out[y] = row;
    }
    return { size: size, modules: out };
  }

  global.QRCode = { encode: encode };
})(typeof window !== 'undefined' ? window : globalThis);
