// ==UserScript==
// @name         XGB430v unlock
// @namespace    https://github.com/tasarren/digi-router-unlocker
// @version      0.1.1
// @description  Digi TP-Link XGB430v Pro web UI: reveal every menu/page the firmware serves to the restricted account + floating tool panel (admin passwords from backup, telnet LAN toggle)
// @homepageURL  https://github.com/tasarren/digi-router-unlocker
// @supportURL   https://github.com/tasarren/digi-router-unlocker/issues
// @downloadURL  https://raw.githubusercontent.com/tasarren/digi-router-unlocker/main/unlock.user.js
// @updateURL    https://raw.githubusercontent.com/tasarren/digi-router-unlocker/main/unlock.user.js
// @match        http://192.168.1.1/*
// @match        https://192.168.1.1/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
// Same file works as a userscript (Tampermonkey/Violentmonkey) and as the MV3 content script in manifest.json.
// Client-side only: the unlock changes what the UI renders, the panel only reads data the logged-in
// account may already download, and the telnet buttons drive the same DEV2_TELNET_CFG OID the
// Administration page would. See VARIABLES.md for what each flag/OID controls.
//
// Structure:
//   1. Unlock (document_start: must run before js/oid_str.js).
//   2. Crypto/portable pipeline (DES-ECB, MD5, TP-Link LZSS, credential extraction) — self-contained,
//      no dependency on page globals; verified against the router's own backup bytes.
//   3. Floating panel (built after DOM ready, actions only on click).
(() => {
  'use strict';

  // ==========================================================================
  // 1) Unlock: three mechanisms, all "define it before the firmware does".
  // ==========================================================================
  const define = Object.defineProperty;

  // a) Un-freeze the ISP restriction flag (oid_str.js freezes it writable:false).
  Object.defineProperty = function (target, prop, descriptor) {
    if (target === window && prop === 'INCLUDE_USER_RESTRICTION') {
      descriptor = { value: 0, writable: true, configurable: true };
    }
    return define(target, prop, descriptor);
  };

  // b) Pre-define flags before oid_str.js runs. `var X=...` cannot overwrite these.
  const predefine = (name, value) => {
    try { define(window, name, { value, writable: false, configurable: false }); } catch (e) { /* already set */ }
  };
  // Kills every `typeof(INCLUDE_DIGI) != "undefined" && $.userType == "User"` menu gate.
  predefine('INCLUDE_DIGI', undefined);
  // Pages exist on this firmware (HTTP 200) but their menu entry needs the flag = 1:
  predefine('INCLUDE_ADVANCED_FIREWALL', 1);     // Security -> firewall.htm + DDoS
  predefine('INCLUDE_GPON_SFU', 1);              // Network -> sfuVlanCfg.htm (SFU VLAN)
  predefine('INCLUDE_CATV', 1);                  // System Tools -> catv.htm
  predefine('INCLUDE_WEB_DISPLAY_PROC_LIST', 1); // System Tools -> applicationList.htm

  // c) frame/menu.cgi evals `var menulist=new Array(...)` (per-account page ACL).
  //    Pre-defined getter survives the var and serves the full list. The Digi-Admin-only
  //    pages (cwmp/snmp/portMirror) are left out on purpose: the server answers 406 for
  //    the user account, so they would be dead menu links.
  const FULL_MENULIST = [
    'menu.htm', 'status.htm', 'quicksetup.htm', 'qsDiag.htm', 'qsIsp.htm', 'qsDsl.htm', 'qsWl.htm', 'qsEnd.htm',
    'qsConnType.htm', 'networkMap.htm', 'sysMode.htm', 'wanBasic.htm', 'wanDefaultGateway.htm', 'ethWan.htm',
    'ethWanEdit.htm', 'wan.htm', 'dslcfg.htm', 'macClone.htm', 'div.htm', 'dsl.htm', 'pppoe.htm', 'pppoa.htm',
    'ipoa.htm', 'dynamicIp.htm', 'staticIp.htm', 'lan6.htm', 'ipv6Tunnel.htm', 'dhcp.htm', 'dhcpEdit.htm',
    'dhcpServer.htm', 'dhcpStaticEdit.htm', 'dhcpCondEdit.htm', 'wirelessBasic.htm', 'guestBasic.htm', 'wps.htm',
    'wlScan_2G.htm', 'wlScan_5G.htm', 'wlScan.htm', 'wlGuestDulBandBasic.htm', 'wlGuestDulBandAdv.htm',
    'wirelessSettings.htm', 'multiSSID.htm', 'multiSSIDBasic.htm', 'wirelessAdv.htm', 'guestNetwork.htm',
    'macFilter.htm', 'wirelessStat.htm', 'wirelessSchedule.htm', 'easyMesh.htm', 'basic3g.htm', 'usb3g.htm',
    'usb3gModemList.htm', 'usbManage.htm', 'diskSettings.htm', 'folderSharing.htm', 'route.htm', 'rip.htm',
    'ddns.htm', 'alg.htm', 'virtualServer.htm', 'portTrigger.htm', 'dmz.htm', 'upnp.htm', 'parentCtrl.htm',
    'ddos.htm', 'accessControl.htm', 'portFiltering.htm', 'ipv6Firewall.htm', 'iqosSettings.htm',
    'iqosDatabase.htm', 'arpBind.htm', 'log.htm', 'logConf.htm', 'time.htm', 'diagnostic.htm', 'manageCtrl.htm',
    'backNRestore.htm', 'softup.htm', 'ledSchedule.htm', 'restart.htm', 'stat.htm', 'gponcfg.htm', 'gponctc.htm',
    'voice_basic.htm', 'voice_advance.htm', 'voice_basic_user.htm', 'voice_advance_user.htm', 'voice_telebook.htm',
    'voice_telephony.htm', 'voice_calllog.htm', 'voice_digitmap.htm', 'voice_electionRule.htm',
    'voice_callblocks.htm', 'voice_callforward.htm', 'voice_usbmail.htm', 'ipsec.htm', 'openvpnServer.htm',
    'pptpvpnServer.htm', 'vpnStatus.htm', 'restartSchedule.htm', 'parentCtrl_v2.htm', 'sessionTimeout.htm',
    'voice_calllogDel.htm', 'voice_usbmail_cap.htm',
    'applicationList.htm', 'catv.htm', 'firewall.htm', 'sfuVlanCfg.htm', 'tr369.htm', 'voice_callthrough.htm',
    'voice_dectadv.htm', 'voice_usbmailBasic.htm',
    // .js entries the original menulist carries; harmless to keep:
    'encrypt.js', 'jquery-1.8.3.min.js', 'jquery.mousewheel.js', 'jquery.tpBtnGroup.js', 'jquery.tpCheckbox.js',
    'jquery.tpFile.js', 'jquery.tpGridSelect.js', 'jquery.tpInit.js', 'jquery.tpModeSelect.js',
    'jquery.tpMsg.js', 'jquery.tpRadio.js', 'jquery.tpSelect.js', 'jquery.tpTable.js', 'keycode.js', 'lib.js',
    'locale.js', 'oid_str.js', 'perfect-scrollbar.js', 'simple-slider.min.js', 'jquery.tpInput.js',
    'offlineError.htm', 'jquery.tpPassword.js', 'jquery.tpCheckPort.js', 'jquery.nicescroll.min.js',
    'mousetrap.min.js', 'jquery.tpButton.js', 'jquery.tpPanelPage.js', 'jquery.tpAria.js',
    'jquery.tpAccessKey.js', 'jquery.tpLink.js', 'jquery.tpCollapse.js', 'jquery.tpFlatButton.js',
    'jquery.tpTooltip.js', 'jquery.tpModal.js', 'su.js', 'gdprProxy.js', 'root.js', 'cryptoJS.min.js',
    'tpEncrypt.js', 'proxy.js', 'isp.js', 'isp3g.js', 'ispVoIP.js', 'wireless.js', 'simple-slider.js',
    'corner.js', 'Chart.js', 'jquery.tpSearchInput.js', 'jquery.tpAddress.js', 'excanvas.js', 'ispMgr.js'
  ];
  try {
    define(window, 'menulist', {
      configurable: false,
      get() { return FULL_MENULIST; },
      set() { /* menu.cgi's var declaration becomes a no-op */ }
    });
  } catch (e) { /* page without menu.cgi */ }
  // ponytail: hardcoded menulist mirrors firmware "0.2.0 3.2.1 v60c3.0 Build 250808 Rel.72518n";
  // a firmware update may add/rename pages: diff frame/menu.cgi and update FULL_MENULIST then.

  // ==========================================================================
  // 2) Portable pipeline: DES-ECB, MD5, TP-Link LZSS, backup decryption,
  //    credential extraction. Pure JS, no page dependencies, no network of
  //    its own. Implements this firmware's encrypted backup format.
  // ==========================================================================

  // --- MD5 (returns lowercase hex) ----------------------------------------
  const MD5 = (() => {
    const K = new Int32Array(64);
    for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
    const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
    const rol = (x, c) => (x << c) | (x >>> (32 - c));
    return function md5Hex(bytes) {
      const len = bytes.length;
      const withPad = new Uint8Array((((len + 8) >> 6) + 1) * 64);
      withPad.set(bytes);
      withPad[len] = 0x80;
      const bitLen = len * 8;
      withPad[withPad.length - 8] = bitLen & 0xff;
      withPad[withPad.length - 7] = (bitLen >>> 8) & 0xff;
      withPad[withPad.length - 6] = (bitLen >>> 16) & 0xff;
      withPad[withPad.length - 5] = (bitLen >>> 24) & 0xff;
      let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
      const M = new Int32Array(16);
      for (let off = 0; off < withPad.length; off += 64) {
        for (let i = 0; i < 16; i++) {
          M[i] = (withPad[off + i * 4] | (withPad[off + i * 4 + 1] << 8)
            | (withPad[off + i * 4 + 2] << 16) | (withPad[off + i * 4 + 3] << 24));
        }
        let A = a0, B = b0, C = c0, D = d0;
        for (let i = 0; i < 64; i++) {
          let F, g;
          if (i < 16) { F = (B & C) | (~B & D); g = i; }
          else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
          else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
          else { F = C ^ (B | ~D); g = (7 * i) % 16; }
          F = (F + A + K[i] + M[g]) | 0;
          A = D; D = C; C = B;
          B = (B + rol(F, S[(i >> 4) * 4 + (i & 3)])) | 0;
        }
        a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
      }
      const out = new Uint8Array(16);
      [a0, b0, c0, d0].forEach((word, i) => {
        out[i * 4] = word & 0xff; out[i * 4 + 1] = (word >>> 8) & 0xff;
        out[i * 4 + 2] = (word >>> 16) & 0xff; out[i * 4 + 3] = (word >>> 24) & 0xff;
      });
      return [...out].map(b => b.toString(16).padStart(2, '0')).join('');
    };
  })();

  // --- DES-ECB (single DES; the router's TripleDES call is key,key,key) ----
  const DES = (() => {
    const PC1 = [57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19,
      11, 3, 60, 52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53,
      45, 37, 29, 21, 13, 5, 28, 20, 12, 4];
    const PC2 = [14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13,
      2, 41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32];
    const SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
    const IP = [58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22,
      14, 6, 64, 56, 48, 40, 32, 24, 16, 8, 57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11,
      3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7];
    const FP = [40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22,
      62, 30, 37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59,
      27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25];
    const E = [32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17, 16,
      17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1];
    const P = [16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3,
      9, 19, 13, 30, 6, 22, 11, 4, 25];
    const SBOX = [
      [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
      [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
      [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
      [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
      [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
      [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
      [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
      [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11]
    ];
    const bits = (bytes, off) => {
      const out = new Array(64);
      for (let i = 0; i < 8; i++)
        for (let j = 0; j < 8; j++)
          out[i * 8 + j] = (bytes[off + i] >> (7 - j)) & 1;
      return out;
    };
    const pack = (b) => {
      const out = new Uint8Array(8);
      for (let i = 0; i < 8; i++) {
        let v = 0;
        for (let j = 0; j < 8; j++) v = (v << 1) | b[i * 8 + j];
        out[i] = v;
      }
      return out;
    };
    const permute = (input, table) => table.map(i => input[i - 1]);
    const rotl = (arr, n) => arr.slice(n).concat(arr.slice(0, n));
    const keySchedule = (keyBytes) => {
      const k = permute(bits(keyBytes, 0), PC1);
      const C = k.slice(0, 28), D = k.slice(28);
      const out = [];
      for (let i = 0; i < 16; i++) {
        const c = rotl(C, SHIFTS[i]), d = rotl(D, SHIFTS[i]);
        out.push(permute(c.concat(d), PC2));
        C.length = 0; C.push(...c); D.length = 0; D.push(...d);
      }
      return out;
    };
    const feistel = (R, K) => {
      const x = permute(R, E).map((b, i) => b ^ K[i]);
      const out = new Array(32);
      for (let s = 0; s < 8; s++) {
        const b = x.slice(s * 6, s * 6 + 6);
        const row = (b[0] << 1) | b[5];
        const col = (b[1] << 3) | (b[2] << 2) | (b[3] << 1) | b[4];
        const v = SBOX[s][row * 16 + col];
        out[s * 4] = (v >> 3) & 1; out[s * 4 + 1] = (v >> 2) & 1;
        out[s * 4 + 2] = (v >> 1) & 1; out[s * 4 + 3] = v & 1;
      }
      return permute(out, P);
    };
    const block = (bytes, off, subkeys, decrypt) => {
      const b = permute(bits(bytes, off), IP);
      let L = b.slice(0, 32), R = b.slice(32);
      for (let i = 0; i < 16; i++) {
        const k = subkeys[decrypt ? 15 - i : i];
        const f = feistel(R, k);
        const t = R; R = L.map((v, j) => v ^ f[j]); L = t;
      }
      return pack(permute(R.concat(L), FP));
    };
    return {
      ecb(bytes, key, decrypt) {
        const subkeys = keySchedule(key);
        const out = new Uint8Array(bytes.length);
        for (let off = 0; off < bytes.length; off += 8)
          out.set(block(bytes, off, subkeys, decrypt), off);
        return out;
      },
      // debug/testing hooks
      _keySchedule: keySchedule, _feistel: feistel, _block: block,
    };
  })();

  // Backup key: 748da50bf93e2dcf XOR ASCII "40981e01" (hex of ProductID 1083710977).
  const BACKUP_KEY = Uint8Array.from([0x74, 0x8d, 0xa5, 0x0b, 0xf9, 0x3e, 0x2d, 0xcf]
    .map((b, i) => b ^ '40981e01'.charCodeAt(i)));

  const MAX_XML = 4 * 1024 * 1024;

  // --- TP-Link LZSS decompressor ------------------------------------------
  function lzss(src) {
    if (src.length < 5) throw new Error('LZSS: truncated stream');
    const be = ((src[0] << 24) | (src[1] << 16) | (src[2] << 8) | src[3]) >>> 0;
    const le = (src[0] | (src[1] << 8) | (src[2] << 16) | (src[3] << 24)) >>> 0;
    const sizes = [...new Set([be, le].filter(n => n >= 1 && n <= MAX_XML))];
    if (!sizes.length) throw new Error('LZSS: invalid size header');
    const ok = [];
    for (const size of sizes) {
      try {
        let pos = 5, flagWord = 0, bitsLeft = 0;
        const out = [src[4]];
        const take = () => { if (pos >= src.length) throw 0; return src[pos++]; };
        const bit = () => {
          if (!bitsLeft) { flagWord = take() | (take() << 8); bitsLeft = 16; }
          bitsLeft--;
          return (flagWord >> bitsLeft) & 1;
        };
        const variable = () => {
          let v = 1;
          for (let i = 0; i < 24; i++) {
            v = (v << 1) | bit();
            if (!bit()) return v;
          }
          throw 0;
        };
        while (out.length < size) {
          if (bit()) {
            const count = variable() + 2;
            const distance = ((variable() - 2) << 8) + take() + 1;
            if (distance > out.length || count > size - out.length) throw 0;
            for (let i = 0; i < count; i++) out.push(out[out.length - distance]);
          } else out.push(take());
        }
        if (src.length - pos > 7 || src.slice(pos).some(b => b !== 0)) throw 0;
        const head = out.slice(0, 16).map(b => String.fromCharCode(b)).join('').replace(/^\s+/, '');
        if (!head.startsWith('<?xml') && !head.startsWith('<DslCpeConfig')) throw 0;
        ok.push(out);
      } catch (e) { /* try the other endianness */ }
    }
    if (ok.length !== 1) throw new Error('LZSS: ambiguous or corrupt stream');
    return Uint8Array.from(ok[0]);
  }

  // --- Backup: DES decrypt -> MD5 header check -> plain XML or LZSS --------
  function decryptBackup(bytes) {
    if (bytes.length < 24 || bytes.length % 8) throw new Error('Not a valid DES backup (bad length)');
    const plain = DES.ecb(bytes, BACKUP_KEY, true);
    const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    const header = hex(plain.subarray(0, 16));
    for (let padding = 0; padding < 8; padding++) {
      if (padding && !plain.subarray(plain.length - padding).every(b => b === 0)) continue;
      const candidate = padding ? plain.subarray(16, plain.length - padding) : plain.subarray(16);
      if (MD5(candidate) !== header) continue;
      const head = [...candidate.subarray(0, 16)].map(b => String.fromCharCode(b)).join('').replace(/^\s+/, '');
      if (head.startsWith('<?xml') || head.startsWith('<DslCpeConfig')) return candidate;
      return lzss(candidate);
    }
    throw new Error('MD5 mismatch: wrong firmware or damaged download');
  }

  // --- Credential extraction from the decoded config text ------------------
  const decodeEntities = s => s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e]));

  function val(tag, block) {
    const m = block.match(new RegExp('<' + tag + '\\s+val=(?:"([\\s\\S]*?)"|([^\\s<>]*))\\s*/>'));
    if (!m) return null;
    return decodeEntities(m[1] !== undefined ? m[1] : m[2]);
  }

  function extractCredentials(text) {
    const accounts = [];
    // <Users> <User instance=N> <Username val=../><Password val=../> </User> </Users>
    const users = text.match(/<Users>[\s\S]*?<\/Users>/);
    if (users) {
      for (const b of (users[0].match(/<User\s+instance=\d+[^>]*>[\s\S]*?<\/User>/g) || [])) {
        accounts.push(['Admin', val('Username', b), val('Password', b)]);
      }
    }
    // PPPoE: <PPP><Interface instance=N><Username/><Password/></Interface></PPP>
    // (this firmware) and the classic <WANPPPConnection> blocks on others.
    const ppp = text.match(/<PPP>[\s\S]*?<\/PPP>/);
    if (ppp) {
      for (const b of (ppp[0].match(/<Interface\s+instance=\d+[^>]*>[\s\S]*?<\/Interface>/g) || [])) {
        const u = val('Username', b), p = val('Password', b);
        if (u || p) accounts.push(['PPPoE', u, p]);
      }
    }
    for (const m of text.matchAll(/<WANPPPConnection[^>]*>([\s\S]*?)<\/WANPPPConnection>/g)) {
      const u = val('Username', m[1]), p = val('Password', m[1]);
      if (u || p) accounts.push(['PPPoE', u, p]);
    }
    // SIP: any element holding authusername/authpassword (voice profiles)
    for (const m of text.matchAll(/<SIP[^>]*>([\s\S]*?)<\/SIP>/g)) {
      const u = val('AuthUsername', m[1]) || val('Username', m[1]);
      const p = val('AuthPassword', m[1]) || val('Password', m[1]);
      if (u || p) accounts.push(['SIP', u, p]);
    }
    return accounts;
    // ponytail: regex targets this firmware's backup dialect (Users/WANPPPConnection/SIP
    // blocks). If a firmware change hides credentials elsewhere, extend this parser
    // to walk the config tree with account context.
  }

  const display = v => (v === null || !v.trim() || ['(null)', 'null', 'none', 'n/a'].includes(v.trim().toLowerCase()))
    ? '(not available)' : (/^[*•]+$/.test(v) ? '(hidden)' : v);

  // Expose for testing/debugging (console: __xgb430v.decryptBackup(...)).
  window.__xgb430v = { MD5, DES, lzss, decryptBackup, extractCredentials, BACKUP_KEY };

  // ==========================================================================
  // 3) Floating panel (top frame only; actions only on click).
  // ==========================================================================
  // Short explanations for the flags/OIDs that matter on this firmware.
  // Anything not listed here is a build/feature flag of little interest.
  const FLAG_DOCS = {
    INCLUDE_USER_RESTRICTION: 'ISP account restriction; extension forces 0 (unlocks page locks + telnet/SSH controls)',
    INCLUDE_DIGI: 'Digi user-account menu gates; extension forces undefined',
    INCLUDE_ADVANCED_FIREWALL: 'Security -> full firewall page + DDoS; extension forces 1',
    INCLUDE_GPON_SFU: 'Network -> SFU VLAN page; extension forces 1',
    INCLUDE_CATV: 'System Tools -> CATV page; extension forces 1',
    INCLUDE_WEB_DISPLAY_PROC_LIST: 'System Tools -> application list; extension forces 1',
    INCLUDE_WEB_TELNET: 'local telnet UI on manageCtrl.htm (Administration)',
    INCLUDE_REMOTE_TELNET: 'remote telnet UI on manageCtrl.htm',
    INCLUDE_WEB_TELNET_FOR_USER: 'telnet UI for the restricted account (redundant while USER_RESTRICTION=0)',
    INCLUDE_SSH_ACCESS: 'SSH local/remote management UI',
    INCLUDE_REMOTE_HTTP_SUPER_CTRL: 'super-admin remote HTTP (Digi admin only)',
    INCLUDE_RIP: 'RIP settings menu entry',
    INCLUDE_TELNET_LOGIN_WAIT: 'telnet login throttle',
    INCLUDE_AGC_DIS_TELNETFULLRESET: 'disables restore-to-default via telnet',
    INCLUDE_FORBID_LOGIN_TIME: 'web login lockout seconds after failures',
  };

  // DEV2_* OIDs the panel reads live; desc says what knowing/changing it gives you.
  const OID_DOCS = [
    ['DEV2_TELNET_CFG', ['telnetLocalEnabled', 'telnetRemoteEnabled', 'telnetRemotePort'],
      'telnetd switch — panel Enable/Disable buttons set telnetLocalEnabled; login = admin + operator password'],
    ['DEV2_SSH_CFG', ['localEnabled', 'remoteEnabled', 'localPort', 'remotePort'],
      'SSH management switch (same pattern as telnet; localEnabled drives the panel button)'],
    ['DEV2_CURRENT_USER', ['userSetting', 'userRole'],
      'account type you logged in as (4 = restricted Digi user)'],
    ['DEV2_DEV_INFO', ['modelName', 'X_TP_DevModelVersion', 'X_TP_BuildDate', 'X_TP_BuildTime'],
      'device metadata — feeds the backup filename formula'],
    ['DEV2_SYS_CFG', ['signStatus'],
      'signed-config indicator for the backup filename'],
  ];

  function hasSession() {
    // The logged-in shell always carries #mainBody, and its banner adds
    // #topLogout once frame/top.htm loads. The login page has neither.
    // (JSESSIONID is set before login too, so it cannot be used here.)
    try {
      if (document.querySelector('#mainBody, #topLogout')) return true;
    } catch (e) { /* no DOM yet */ }
    try { return /(?:^|;\s*)Authorization=/.test(document.cookie); } catch (e) { return false; }
  }

  function dmGetSync(oid, data) {
    if (!hasSession()) return null;
    let result = null;
    try {
      window.$.dm.getSync({ oid, data, callback: { success: d => { result = d; } } });
    } catch (e) { return null; }
    // $.dm.getSync hands the callback the bare data object (see tpCheckPort.js),
    // not the {data:...} envelope.
    if (result == null) return null;
    return (result && result.data !== undefined) ? result.data : result;
  }

  function backupUrl() {
    const info = dmGetSync('DEV2_DEV_INFO', {
      modelName: '', 'X_TP_DevModelVersion': '', 'X_TP_BuildDate': '', 'X_TP_BuildTime': ''
    });
    if (!info || info.modelName === undefined)
      throw new Error('Log in to the router first (device info unreadable)');
    const modelName = info.modelName.replace(/\s/g, '');
    const version = info.X_TP_DevModelVersion;
    const major = version.slice(0, version.indexOf('.'));
    let sign = 'n';
    if (window.INCLUDE_DIGITAL_SIGNATURE) {
      const sys = dmGetSync('DEV2_SYS_CFG', { signStatus: '' });
      sign = sys.signStatus != '0' ? 's' : 'n';
    }
    let url = '/cgi/' + modelName + 'V' + major + info.X_TP_BuildDate + info.X_TP_BuildTime + sign;
    if (window.INCLUDE_BOOT_AGINETCONFIG)
      url += '_' + window.INCLUDE_BOOT_AGINETCONFIG_PLATFORM + '_' + window.INCLUDE_BOOT_AGINETCONFIG_CONFIGKEY;
    return url + '_backupcfg.bin';
  }

  let cachedAccounts = null;

  async function obtainPasswords(output, allowCache) {
    if (allowCache && cachedAccounts) return cachedAccounts;
    if (!window.$ || !window.$.dm || !hasSession())
      throw new Error('Log in to the router first (no DM API or no session on this page)');
    output('Fetching backup path from DEV2_DEV_INFO...');
    const url = backupUrl();
    output('GET ' + url);
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' (need a session; reload after login)');
    const bytes = new Uint8Array(await res.arrayBuffer());
    output('Downloaded ' + bytes.length + ' bytes; decrypting (DES-ECB)...');
    // decryptBackup: DES -> MD5 check -> LZSS if needed -> config XML bytes
    const text = new TextDecoder().decode(decryptBackup(bytes));
    const accounts = extractCredentials(text);
    if (!accounts.length) throw new Error('No credential blocks found in backup');
    cachedAccounts = accounts;
    return accounts;
  }

  // Paginated, searchable variables view: every window.INCLUDE_* flag
  // (10 per page, filter box on top) plus live reads of the interesting
  // OIDs. DM reads use data:{} like the firmware pages do; named-field
  // reads return errorcode 9003 and pop the page's own alert dialog.
  function buildVarsUI() {
    const root = document.createElement('div');
    const heading = (text) => {
      const d = document.createElement('div');
      d.className = 'du-h';
      d.textContent = text;
      return d;
    };
    const row = (table, cells, note) => {
      const tr = document.createElement('tr');
      if (note) tr.className = 'du-note';
      for (const c of cells) {
        const td = document.createElement('td');
        if (c.v !== undefined) { td.className = 'du-v'; td.textContent = c.v; }
        else td.textContent = c.t;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    };
    const table = (headerText) => {
      root.appendChild(heading(headerText));
      const t = document.createElement('table');
      root.appendChild(t);
      return t;
    };

    // DEV2_* live reads (few rows, no pagination needed)
    const t2 = table(hasSession()
      ? 'Data model (live DEV2_* reads)'
      : 'Data model (log in for live DEV2_* reads)');
    for (const [oid, fields, doc] of OID_DOCS) {
      let vals = null;
      try {
        const data = dmGetSync(oid, {});
        if (data) vals = fields.map(f => `${f}=${data[f] === undefined ? '?' : JSON.stringify(data[f])}`).join('  ');
      } catch (e) { /* leave null */ }
      row(t2, [{ t: oid }, { v: vals || '—' }, { t: doc }], !!vals);
    }

    // INCLUDE_* flags: search box + 10-per-page table
    root.appendChild(heading('UI flags (window.INCLUDE_*) — highlighted rows are unlocked by the extension'));
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search flag / value / description...';
    search.className = 'du-search';
    root.appendChild(search);
    const t1 = document.createElement('table');
    root.appendChild(t1);
    const pager = document.createElement('div');
    pager.className = 'du-pager';
    const prev = document.createElement('button'); prev.textContent = '‹ prev';
    const info = document.createElement('span');
    const next = document.createElement('button'); next.textContent = 'next ›';
    pager.append(prev, info, next);
    root.appendChild(pager);

    const PER_PAGE = 10;
    let page = 0, query = '';
    const flags = Object.keys(window).filter(k => /^INCLUDE_/.test(k)).sort()
      .map(k => ({ k, v: window[k], doc: FLAG_DOCS[k] || '' }));
    const filtered = () => {
      const q = query.toLowerCase();
      return q ? flags.filter(x => (x.k + ' ' + String(x.v) + ' ' + x.doc).toLowerCase().includes(q)) : flags;
    };
    const render = () => {
      const list = filtered();
      const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
      if (page >= pages) page = pages - 1;
      t1.textContent = '';
      for (const x of list.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)) {
        const v = x.v === undefined ? 'undefined' : JSON.stringify(x.v);
        row(t1, [{ t: x.k }, { v }, { t: x.doc }], !!x.doc);
      }
      info.textContent = `page ${page + 1}/${pages} — ${list.length} flags`;
      prev.disabled = page === 0;
      next.disabled = page >= pages - 1;
    };
    search.addEventListener('input', () => { query = search.value.trim(); page = 0; render(); });
    prev.addEventListener('click', () => { if (page > 0) { page--; render(); } });
    next.addEventListener('click', () => { page++; render(); });
    render();

    root.appendChild(heading(`menulist: ${FULL_MENULIST.length} pages the menu may show (server ACL patched client-side; full story in VARIABLES.md)`));
    return root;
  }

  function buildPanel() {
    if (window.top !== window.self) return;
    if (document.getElementById('digi-unlock-panel')) return;
    const style = document.createElement('style');
    style.textContent = `
      #digi-unlock-panel{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:460px;
        min-width:min(340px,94vw);max-width:94vw;max-height:94vh;resize:both;overflow:hidden;
        background:#141a22;color:#d8dee6;font:12px/1.45 ui-monospace,monospace;border-radius:10px;
        box-shadow:0 6px 24px rgba(0,0,0,.45);border:1px solid #2c3542;user-select:text}
      #digi-unlock-panel .du-head{display:flex;align-items:center;justify-content:space-between;
        padding:8px 12px;cursor:pointer;background:#1b2330;border-radius:10px 10px 0 0;
        font-weight:600;letter-spacing:.02em;color:#e6edf3}
      #digi-unlock-panel .du-head > span{color:#e6edf3}
      #digi-unlock-panel .du-head small{font-weight:400;color:#9fb0c4}
      #digi-unlock-panel .du-head .du-auth{display:none;font-weight:400;color:#ffd58a}
      #digi-unlock-panel .du-head .du-auth.du-show{display:inline}
      #digi-unlock-panel.du-closed .du-body{display:none}
      #digi-unlock-panel .du-body{padding:10px 12px 12px}
      #digi-unlock-panel button{display:block;width:100%;margin:4px 0;padding:6px 8px;cursor:pointer;
        background:#2b3b52;color:#e6edf3;border:1px solid #3d4f6b;border-radius:6px;font:inherit;text-align:left}
      #digi-unlock-panel button:hover{background:#365070}
      #digi-unlock-panel button:disabled{opacity:.45;cursor:not-allowed;background:#242d3a}
      #digi-unlock-panel .du-toggle.du-on{background:#1d4426;border-color:#2e7d43}
      #digi-unlock-panel .du-toggle.du-on:hover{background:#256031}
      #digi-unlock-panel .du-toggle.du-off{background:#3a4250;border-color:#57637a;color:#9aa7b8}
      #digi-unlock-panel .du-out{margin-top:6px;padding:6px;max-height:180px;overflow:auto;
        white-space:pre-wrap;word-break:break-all;background:#0d1117;border-radius:6px;color:#9fe3a1;
        display:none}
      #digi-unlock-panel .du-out.du-show{display:block}
      #digi-unlock-panel .du-vars{margin-top:6px;padding:8px;max-height:46vh;overflow:auto;
        background:#0d1117;border-radius:6px;color:#cdd9e5;display:none}
      #digi-unlock-panel .du-vars.du-show{display:block}
      #digi-unlock-panel .du-vars .du-h{padding:4px 2px;color:#e6edf3;font-weight:600}
      #digi-unlock-panel .du-vars .du-search{width:100%;box-sizing:border-box;margin:4px 0 8px;
        padding:5px 8px;background:#0a0e13;color:#e6edf3;border:1px solid #2c3542;border-radius:6px;
        font:inherit;outline:none}
      #digi-unlock-panel .du-vars .du-search:focus{border-color:#3d6ea5}
      #digi-unlock-panel .du-vars table{width:100%;table-layout:fixed;border-collapse:collapse;
        font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
      #digi-unlock-panel .du-vars td{padding:4px 8px;border-bottom:1px solid #1d2735;
        vertical-align:top;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      #digi-unlock-panel .du-vars td:nth-child(1){width:46%}
      #digi-unlock-panel .du-vars td:nth-child(2){width:16%}
      #digi-unlock-panel .du-vars td:nth-child(3){width:38%;white-space:normal;
        overflow:visible;text-overflow:clip;color:#8fa3bd}
      #digi-unlock-panel .du-vars td.du-v{color:#8be28b}
      #digi-unlock-panel .du-vars tr.du-note td{background:#182231}
      #digi-unlock-panel .du-vars tr.du-note td:first-child{color:#fff;font-weight:600}
      #digi-unlock-panel .du-pager{display:flex;gap:8px;align-items:center;justify-content:center;
        padding:8px 0 2px;color:#9aa7b8;font-size:11px}
      #digi-unlock-panel .du-pager button{width:auto;margin:0;padding:2px 12px;text-align:center}
      #digi-unlock-panel .du-pager button:disabled{opacity:.4;cursor:default}
      @media (max-width:520px){
        #digi-unlock-panel .du-actions{display:grid;grid-template-columns:1fr 1fr;gap:4px}
        #digi-unlock-panel .du-actions button{margin:0}
        #digi-unlock-panel #du-vars{grid-column:1/-1}
      }
    `;
    const panel = document.createElement('div');
    panel.id = 'digi-unlock-panel';
    panel.innerHTML = `
      <div class="du-head"><span>XGB430v unlock <small id="du-auth" class="du-auth">— log in to enable tools</small></span><small id="du-caret">&#9660;</small></div>
      <div class="du-body">
        <div class="du-actions">
          <button id="du-pass" class="du-action">Obtain admin passwords</button>
          <button id="du-pppoe" class="du-action">Obtain PPPoE credentials</button>
          <button id="du-telnet" class="du-action du-toggle">Telnet (LAN): ...</button>
          <button id="du-ssh" class="du-action du-toggle">SSH (LAN): ...</button>
          <button id="du-vars" class="du-action">Variables (INCLUDE_* / DEV2_*)</button>
        </div>
        <div class="du-out" id="du-out"></div>
        <div class="du-vars" id="du-vars-box"></div>
      </div>`;
    document.documentElement.appendChild(style);
    document.documentElement.appendChild(panel);

    const out = panel.querySelector('#du-out');
    const head = panel.querySelector('.du-head');
    const caret = panel.querySelector('#du-caret');
    const setCaret = () => { caret.innerHTML = panel.classList.contains('du-closed') ? '&#9656;' : '&#9660;'; };
    head.addEventListener('click', () => {
      panel.classList.toggle('du-closed');
      try { localStorage.setItem('digiUnlockCollapsed', panel.classList.contains('du-closed') ? '1' : ''); } catch (e) {}
      setCaret();
    });
    try { if (localStorage.getItem('digiUnlockCollapsed')) panel.classList.add('du-closed'); } catch (e) {}
    // On short viewports an expanded logged-out panel can cover the router's
    // Log in button, so start collapsed; the header still carries the hint.
    if (!hasSession() && window.innerHeight < 560) panel.classList.add('du-closed');
    setCaret();

    const show = (msg, isError) => {
      out.textContent = msg;
      out.classList.add('du-show');
      out.style.color = isError ? '#ff9d9d' : '#9fe3a1';
      panel.classList.remove('du-closed');
      setCaret();
    };
    const authNote = panel.querySelector('#du-auth');
    const actionButtons = panel.querySelectorAll('.du-action');
    function applyAuthState() {
      const loggedIn = hasSession();
      authNote.classList.toggle('du-show', !loggedIn);
      for (const btn of actionButtons) btn.disabled = !loggedIn;
      return loggedIn;
    }
    const run = async (action, label) => {
      try {
        show(label + '...running');
        const result = await action();
        if (result !== undefined) show(result);
      } catch (e) {
        show(label + ' failed: ' + (e && e.message ? e.message : e), true);
      }
    };
    panel.querySelector('#du-pass').addEventListener('click', () => run(async () => {
      const accounts = await obtainPasswords(m => show(m), false);
      return accounts.map(([kind, u, p]) => `${kind}: ${display(u)}  /  ${display(p)}`).join('\n')
        + '\n(copy freely; nothing is saved)';
    }, 'Obtain admin passwords'));
    panel.querySelector('#du-pppoe').addEventListener('click', () => run(async () => {
      const accounts = await obtainPasswords(m => show(m), true);
      const ppp = accounts.filter(([kind]) => kind === 'PPPoE');
      return ppp.length
        ? ppp.map(([, u, p]) => `PPPoE: ${display(u)}  /  ${display(p)}`).join('\n')
        : 'No PPPoE credentials in the backup';
    }, 'Obtain PPPoE credentials'));
    const varsBox = panel.querySelector('#du-vars-box');
    panel.querySelector('#du-vars').addEventListener('click', () => {
      if (varsBox.classList.contains('du-show')) {
        varsBox.classList.remove('du-show');
      } else {
        varsBox.replaceChildren(buildVarsUI());
        varsBox.classList.add('du-show');
        refreshToggles();
      }
    });
    // Live service toggles: green = enabled, gray = disabled, neutral = unknown.
    function setToggle(btn, label, state) {
      btn.textContent = `${label}: ${state === true ? 'Enabled' : state === false ? 'Disabled' : 'unknown (log in)'}`;
      btn.classList.toggle('du-on', state === true);
      btn.classList.toggle('du-off', state === false);
    }
    function readStates() {
      const out = { telnet: null, ssh: null };
      if (window.$ && window.$.dm && hasSession()) {
        try {
          const t = dmGetSync('DEV2_TELNET_CFG', {});
          if (t && t.telnetLocalEnabled !== undefined) out.telnet = t.telnetLocalEnabled == '1';
        } catch (e) { /* not logged in */ }
        try {
          const s = dmGetSync('DEV2_SSH_CFG', {});
          if (s && s.localEnabled !== undefined) out.ssh = s.localEnabled == '1';
        } catch (e) { /* not logged in */ }
      }
      return out;
    }
    function refreshToggles() {
      const st = readStates();
      setToggle(panel.querySelector('#du-telnet'), 'Telnet (LAN)', st.telnet);
      setToggle(panel.querySelector('#du-ssh'), 'SSH (LAN)', st.ssh);
      return st;
    }
    function toggleService(oid, field, current, label) {
      if (current === null || !window.$ || !window.$.dm) {
        show(`${label}: cannot read current state — log in first.`, true);
        return;
      }
      window.$.dm.set({
        oid,
        data: { [field]: current ? 0 : 1 },
        callback: {
          success: () => {
            refreshToggles();
            show(`${label} ${current ? 'disabled' : 'enabled'} (LAN only; remote management untouched).`);
          },
          error: () => show(`${label} change rejected by the router.`, true),
        }
      });
    }
    panel.querySelector('#du-telnet').addEventListener('click', () => {
      const st = readStates();
      toggleService('DEV2_TELNET_CFG', 'telnetLocalEnabled', st.telnet, 'Telnet');
    });
    panel.querySelector('#du-ssh').addEventListener('click', () => {
      const st = readStates();
      toggleService('DEV2_SSH_CFG', 'localEnabled', st.ssh, 'SSH');
    });
    refreshToggles();
    applyAuthState();
    // Login normally reloads the page; if it ever happens in place, enable the
    // buttons as soon as the logged-in shell/banner appears.
    if (!hasSession()) {
      const authWatch = new MutationObserver(() => {
        if (!hasSession()) return;
        authWatch.disconnect();
        applyAuthState();
        refreshToggles();
      });
      authWatch.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
  else buildPanel();
})();
