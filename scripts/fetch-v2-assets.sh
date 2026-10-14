#!/usr/bin/env bash
# Phase 31 · Bucket F v2 — fetch the final brand pack (Drive → assets/v2/).
#
# Source of truth: Ahmad's Google Drive folders
#   XR-Avatar-Animations-V2  1Vz-9iqQm2cnTgz2L1pPmVMPJPokNyrT-
#   Scalable Masters — SVG   1IKX6_y_j1CfMpiPfqYMDEQpb9pIK0VRR
#   Scalable Masters — SVGZ  1zu5xyveB1JZX94Mlj5jyan3f-bJ3f2WX
#   4x PNG Exports           13tQO19aLMJsOEthNfyn1TTNgvkJB3Psr
#   Official Icon Family v2  1IPKZc-Y9IsQVKBjobbpPN9CEJHiRX_Ad
#   Orb-V2 + App Icons       1C5Ic8DCH7_Th4zNITObuW0mTnlhX2cwG
#
# The files are NOT public — direct curl only works when a file is shared
# "anyone with the link". In the Arena/agent environment the same files were
# staged with the Drive connector (google_drive__download_file), which lands
# them byte-identical; this script is the reproducible curl path for a
# maintainer whose Drive files are link-shared (or who adapts it to gdown).
#
# After download it writes assets/v2/MANIFEST.json (sha256 + bytes per file).
# assets/v2/ is gitignored except MANIFEST.json, so CI can verify a staged
# pack against the committed manifest without committing 75MB of masters.
#
# NOT staged: App-Icons PNG colorways (PNG-Cyan/Silver/Ink, 624 files).
# The app renders the 104 SVGs with currentColor (preferred per Bucket F F4);
# the colorway folders remain in Drive (App-Icons folder above) if a native
# surface ever needs pre-rendered PNGs.
set -euo pipefail
cd "$(dirname "$0")/.."

# id|staging-relative-path
FILES=(
"1KWLfq-jz2fUgyLXukCZdjeG0ud2wVOsV|masters/svg/XR-Avatar-Front.svg"
"19V5c5tBCSqDEyAXLxUzmr-_Y1_MmOgqy|masters/svg/XR-Avatar-Side-1.svg"
"1LGy_xBoAHN7j3qJQRt8XVmb_r_D7rDve|masters/svg/XR-Avatar-Side-2.svg"
"1Vt6ozFrGdqzIUE9eGAnvpcziEdr5oxCe|masters/svg/XR-Logo-Transparent.svg"
"1CFGX79LNrZoFI2MmHxRpIzlVnxHUMV1m|masters/svg/XR-Logo-Original-Background.svg"
"1L4g4VVYAOc3uWvfJqLq4pJAGmh7BGYpJ|masters/svgz/XR-Avatar-Front.svgz"
"1cQLPLlLuj1b1Slgtt0iT1p5eZHtX7WC7|masters/svgz/XR-Avatar-Side-1.svgz"
"1oKrexjsCRwJ9gpWudOJV_ANBFw7C8v0V|masters/svgz/XR-Avatar-Side-2.svgz"
"1PuBOnahG_FxSf1io0dFIVJDT402fHNDF|masters/svgz/XR-Logo-Transparent.svgz"
"1gns09c4gIgZW_UQwswz6Q03nbEdpuRLm|masters/svgz/XR-Logo-Original-Background.svgz"
"1hCKgr9B8keAgDq0PSr495X3D5Tc7xNoX|masters/png4x/XR-Avatar-Front-4x.png"
"1_t3ymLxNcL15p12LcP6DANw7d8XbZMCE|masters/png4x/XR-Avatar-Side-1-4x.png"
"1YSimKRQv87yUgfLmMQDl3gl9OPMsLzI7|masters/png4x/XR-Avatar-Side-2-4x.png"
"1_VC-e0m9qRfRfUCYz0yIt0WYSI_Inq7q|masters/png4x/XR-Logo-Transparent-4x.png"
"1zdPNs9eAUE_yrtuCiP734pk1WDlWLj3e|masters/png4x/XR-Logo-Original-Background-4x.png"
"1-zBYTO_7e8UyYzY-ZX6t1R-aFKuQz8wV|avatar-gifs/xr-avatar-idle.gif"
"1zggUGMpCTMglNTEUa7XWKk-nNlhVS12Y|avatar-gifs/xr-avatar-listening.gif"
"1Sq3V_D0nps045I0wsoHeeVq9iSTdAYdo|avatar-gifs/xr-avatar-thinking.gif"
"1LH7cdUc9WIs7a67MJQ5ukzzGMWRGBCDP|avatar-gifs/xr-avatar-speaking.gif"
"17YtKJMR1vaKcOSwP8sPtmjQlezRfMJPt|avatar-gifs/xr-avatar-waiting-approval.gif"
"12CwujVSJv684aIUteC9dbQTAzxJVRMPQ|avatar-gifs/xr-avatar-approved.gif"
"1IXFJdd4KTkG2Wj3qdotf40qzzWJlyib9|avatar-gifs/xr-avatar-denied.gif"
"1X24ZrbikJMkeianFHe3GAbh1giKcUHRi|avatar-gifs/xr-avatar-sleeping.gif"
"1vqBBjwa4Y1kYFVnjwGoDC2KbWvIDGJCJ|avatar-gifs/xr-avatar-error.gif"
"1fwGqgGXKc55rxoG3tyeJ3AFph0n1Bv6V|icon-family/svg/XR-App-Icon.svg"
"1uXJOMMfPlcd9ayiO31REX8kh7k47TQVB|icon-family/svg/XR-Favicon.svg"
"10i9LfxDnqT6CIftja2--77iFy1gwTXGy|icon-family/svg/XR-Favicon-Micro.svg"
"1diGd54M2sKx880HXl5uSK-Zy2K8cmmhX|icon-family/svg/XR-Tray-Color.svg"
"1jjjlh_MsOxjfT_QFBkHGUPhQN6TxrLtZ|icon-family/svg/XR-Tray-Micro.svg"
"1gbgyl628dOF_pVqymJ_4ueWeE4MX6rpp|icon-family/svg/XR-Emblem-Transparent.svg"
"1tWk8t5gUfe7-1yPPRj4u4j7AxDbp9Qx9|icon-family/svg/XR-Avatar-Icon.svg"
"1n-ahD4VMIPdLuPwlBLMVNWoPLvxKjqFV|icon-family/svg/XR-Icon-Mono-White.svg"
"1cnc23uBeIoquI9HR8FVFgGzRzbJionnC|icon-family/svg/XR-Icon-Mono-Black.svg"
"1q_b8UujHBduV-OE_OYoNk-Z9uEfGTyr6|icon-family/ico/XR-App-Icon.ico"
"1YbjQmTY8cd5JntUuW31aF4uFHWAf_uem|icon-family/ico/favicon.ico"
"1ZIFkyuuLAPoobaXzf2ah7oMUnokMoAaF|orb-v2/webp/xr-orb2-idle.webp"
"1iaVEBKenzWlvA1WaIht4HbN237IreT1m|orb-v2/webp/xr-orb2-listening.webp"
"1w81m2gGwr5b8jgrfnpWJ223KKLUf72YM|orb-v2/webp/xr-orb2-thinking.webp"
"1t_bCZtmrMrKK3gWiZrmbVOTJeoe27iw4|orb-v2/webp/xr-orb2-speaking.webp"
"16bBT2_x-qAEOiRmaNnzILUK7HFaPIgqZ|orb-v2/webp/xr-orb2-waiting-approval.webp"
"1QBGtaXWmAJbdgmldAVuk5Qh1dkThRGXJ|orb-v2/webp/xr-orb2-approved.webp"
"1FVV8L5j5E-p1vk7TvB3E1OYVU7hfXvVn|orb-v2/webp/xr-orb2-denied.webp"
"1g8Hqu16pCNgntu7pjczqWRNueAXgplwA|orb-v2/webp/xr-orb2-error.webp"
"12tx1aw-qK0W4fA_Yry1gy1LjEYcagyxD|orb-v2/webp/xr-orb2-sleeping.webp"
"1AwoxSRN1wIBgMQ96-mVcNm-vEJkzt2j2|orb-v2/gif/xr-orb2-idle.gif"
"1dkpG-E7pfiRy2lRkD7a4t6rBtQwYac__|orb-v2/gif/xr-orb2-listening.gif"
"1vmpuTk4JzOvq-_XY45wRub09bh43hUf1|orb-v2/gif/xr-orb2-thinking.gif"
"14ktPN89kxp9gAoeKQojRlZsZcVDnYt-3|orb-v2/gif/xr-orb2-speaking.gif"
"1kTXAxNgEnSog_HP8Xp8FHObDcVUZB7Ce|orb-v2/gif/xr-orb2-waiting-approval.gif"
"1lIPfRLkS3pO56ne6okygsxG9fmQAea7m|orb-v2/gif/xr-orb2-approved.gif"
"1op5IQLnqnynFy0IdxOXyrI3UP9ohDxro|orb-v2/gif/xr-orb2-denied.gif"
"1FA6f_A93bdd2rpbiuQNOWyJqchdHvwa5|orb-v2/gif/xr-orb2-error.gif"
"1khw2aD96uCk61w1DJNRQEtpFt5XOIOVJ|orb-v2/gif/xr-orb2-sleeping.gif"
"1Nhzq3aKCv94991E0LACToDDuRQxYsMiR|orb-v2/png/xr-orb2-idle.png"
"1hiyeN1LJTzpBWEEeLh2EmlT_7q-PABdG|orb-v2/png/xr-orb2-listening.png"
"1eQH8stduIThIjT8Ni7v4NlyusMgTSMny|orb-v2/png/xr-orb2-thinking.png"
"1AA6iHyEDc4CpBhE_Whnrf0IQfnSZUDFo|orb-v2/png/xr-orb2-speaking.png"
"1CXbI315uVLxgkvFM8UH47A_l2lRMUqfE|orb-v2/png/xr-orb2-waiting-approval.png"
"1sqLU_DzW93Y-IcpqN9wQXyESIALLeyer|orb-v2/png/xr-orb2-approved.png"
"12GpKpxcps-dwRW3NfnA00poY5cHSxrRC|orb-v2/png/xr-orb2-denied.png"
"1-qfQmDTffgc_d5Zw0WU-34qtZkaIb-w_|orb-v2/png/xr-orb2-error.png"
"1j1LGhJj3J57QjgKFpllygdEcdxL7ldXu|orb-v2/png/xr-orb2-sleeping.png"
"1iTe-KgovQYgkmUi5_XjyWJ3Ktbou7iO_|orb-v2/themes/xr-orb2-theme-nebula.webp"
"1GLWb5eCHKrDJ4BxudGrwbFNWvFiTW50f|orb-v2/themes/xr-orb2-theme-solar.webp"
"1mJt_zzHVTIeLU0BwHaNTYvwNbJVL_J7w|orb-v2/themes/xr-orb2-theme-emerald.webp"
"1ZR9GLAv2P_VzQUi0VO80_Nhefc-EPD-l|orb-v2/themes/xr-orb2-theme-crimson.webp"
"1czZG6GQ9XnjTczP4lbl0SWqd40WruK-j|orb-v2/themes/xr-orb2-theme-nebula.png"
"1TtSZVh1DBbJB143lnnc6qG7047KdDs0G|orb-v2/themes/xr-orb2-theme-solar.png"
"18G7gwjEDJ_9beACrQri9biIJDZ2j6XPb|orb-v2/themes/xr-orb2-theme-emerald.png"
"1-nkhHu33IYgONewUd7xKwSJBUaD0E9JE|orb-v2/themes/xr-orb2-theme-crimson.png"
)

# Icon-family raster buckets: filename carries its bucket. IDs per file:
PNG_FILES=(
"1-v3ef9D4HrvjTXYRw2fJ5BsIYh75zCWQ|icon-family/png/app-icon/XR-App-Icon-16.png"
"1JFKw4gGf592Nx8OHSpcOdt_2xC6QVNms|icon-family/png/app-icon/XR-App-Icon-24.png"
"19CAJP9rRPTEbVJkJc_3Fhmez57UU5hr-|icon-family/png/app-icon/XR-App-Icon-32.png"
"1BkZALaPqoZ9uibWOIRLdz1gVlPbqD_Qj|icon-family/png/app-icon/XR-App-Icon-48.png"
"1ArJdChAJTMT2bwX1BSrnCYhcoRrcDCTa|icon-family/png/app-icon/XR-App-Icon-64.png"
"1xjb-R94lSSZeKIYWMgLSDip6bP3_F-l5|icon-family/png/app-icon/XR-App-Icon-128.png"
"1bM5r-Y2uv7PR29mP4VJDHov7qf4CpjMA|icon-family/png/app-icon/XR-App-Icon-180.png"
"1EY55lUNTHPnHzB40RElZjd1nb8Z6IwJB|icon-family/png/app-icon/XR-App-Icon-192.png"
"188GyAO5sBjj_qF9n80bnT2DbX3mqsnYR|icon-family/png/app-icon/XR-App-Icon-256.png"
"1OQ1LGUXjdQZTc5RD6hbvBX89_Yr3YCH7|icon-family/png/app-icon/XR-App-Icon-512.png"
"1Swz_YiN_7B3Ku-b_N00b1VTzIlJUoFnf|icon-family/png/app-icon/XR-App-Icon-1024.png"
"1K_ehvJmpPb7RZ32B4peDMQ1NtblY8hU_|icon-family/png/app-icon/icon-192.png"
"1upAI0AvPiTtrmgWuuD_0BVRm9fiPKCwx|icon-family/png/app-icon/icon-512.png"
"1jh1-LMs5A1Kxok8GXwWw_qiGPDONSSAe|icon-family/png/app-icon/icon-maskable-512.png"
"1PcZh1UvJPltegyiygkyVJpth_Yk-Foua|icon-family/png/app-icon/apple-touch-icon.png"
"1n_UxXAaydfUYprtEFN32uwcKctat4-f-|icon-family/png/emblem/XR-Emblem-64.png"
"1iwdATg0J01yKb9czNpK-VT4qPtOO29GK|icon-family/png/emblem/XR-Emblem-128.png"
"1PrtpyKPAAnO_kCEgycV0wK037ZUpYk1N|icon-family/png/emblem/XR-Emblem-256.png"
"1wcofpjE_gHgEmUPwiAjcW9Zx4Gil8agD|icon-family/png/emblem/XR-Emblem-512.png"
"1ShX1yrn-0rlpr8tElWavzfxYFPOTzsM_|icon-family/png/emblem/XR-Emblem-1024.png"
"1azEZQ-9RpAv_YHTfIAXK-OmVOmsHqSbK|icon-family/png/favicon/favicon-16.png"
"1WSizyZu88Cy1xzARw3zV5y6NcOoluGN_|icon-family/png/favicon/favicon-24.png"
"1D2OA1qhmWwtn7EkrUyQ-poq55uO2rKSn|icon-family/png/favicon/favicon-32.png"
"13Ya0ls6V8XgTbBVROJStrrcroBWqrCLR|icon-family/png/favicon/favicon-48.png"
"18ld9jYd0M47Jho6BwxPx0-IeunM6Et12|icon-family/png/favicon/favicon-64.png"
"1oKGizUqHVkDxBgBcjJTUmwTQlt4paeFE|icon-family/png/favicon/favicon-128.png"
"12jElPAo-d8_t79MhnoiTcgrpbWbuD4Na|icon-family/png/favicon/favicon-256.png"
"1Dr0COHmWle78eptKlfa5M2Q9afJ8fKuh|icon-family/png/tray/XR-Tray-16.png"
"18iku9aAqxGqoU1mbu4dlh4k_DC__vsgt|icon-family/png/tray/XR-Tray-24.png"
"1s7dSRUosKWEXc1G3woYGHtHeUrpIizO3|icon-family/png/tray/XR-Tray-32.png"
"13GMdOp_SBr1rjmUksWZxL6wFlP5jhuGE|icon-family/png/tray/XR-Tray-48.png"
"1WB0SHpwZcDkelaKgBD16tfdi0lYvGGf1|icon-family/png/tray/XR-Tray-64.png"
"1qQncu-DoBsBz9HFBn5BdF0A3zx2BnRYR|icon-family/png/avatar/XR-Avatar-Icon-48.png"
"136LGY4GIB7HzOAh5x7CXqk5-5AihTzEO|icon-family/png/avatar/XR-Avatar-Icon-64.png"
"1zsjakOafwQgPMnduqXfIhvkQKc72fvEB|icon-family/png/avatar/XR-Avatar-Icon-128.png"
"1pNrygnlWRyeVpj_GltqYweVcj7rceg0n|icon-family/png/avatar/XR-Avatar-Icon-256.png"
"1SY1B5kAPODdhabRF09TVCzinCwfE0zs6|icon-family/png/avatar/XR-Avatar-Icon-512.png"
"1VZe616U_Tlc_mEbZ_W-JF2yvBuMB_JTj|icon-family/png/mono-white/XR-Mono-White-16.png"
"1heZJt2DFrNOAorxLSweiIgtGgPGVygZB|icon-family/png/mono-white/XR-Mono-White-24.png"
"1lVisQgGmP1t9UM73Gije75LV6BuDNrb3|icon-family/png/mono-white/XR-Mono-White-32.png"
"1w54K5pl0An_XtHCMUJbRNzk4w0baHOCO|icon-family/png/mono-white/XR-Mono-White-48.png"
"1ZFcegyWmTHZRjVU_8ElgfC5P1k3JmxaY|icon-family/png/mono-white/XR-Mono-White-64.png"
"1YZnJB9k6S0BFDXNeS2tkE_w15pNxOJdF|icon-family/png/mono-white/XR-Mono-White-256.png"
"1XT4uoyS8MIxZN1IcxeXu7WGNNfMTb4kQ|icon-family/png/mono-black/XR-Mono-Black-16.png"
"1AkUJAawpA3tjk4U2Fn8fRpY8SsAvR4kv|icon-family/png/mono-black/XR-Mono-Black-24.png"
"1OMtfIEaV9dYpNTXT8DyONL6rSGiSIbOt|icon-family/png/mono-black/XR-Mono-Black-32.png"
"17OpQgp3gy7WBRk-qus1dJxJP_ajXAFOm|icon-family/png/mono-black/XR-Mono-Black-48.png"
"1GHMmBxMwOvHRoIWUmQleiV4bGBfHyYla|icon-family/png/mono-black/XR-Mono-Black-64.png"
"1qYOmr-JEhFBYbkZIT8OcyoPoFh8RZNxI|icon-family/png/mono-black/XR-Mono-Black-256.png"
)

dl() {
  local id="$1" rel="$2" out="assets/v2/$rel"
  mkdir -p "$(dirname "$out")"
  if [ -s "$out" ]; then echo "skip (exists) $rel"; return; fi
  curl -fsSL "https://drive.google.com/uc?export=download&confirm=t&id=${id}" -o "$out"
  # Drive serves an HTML interstitial for non-public files — fail loudly.
  if head -c 15 "$out" | grep -qi '<!doctype html'; then
    echo "ERROR: $rel downloaded as HTML (file not link-shared?). Use the Drive connector fallback." >&2
    rm -f "$out"; return 1
  fi
  echo "ok $rel"
}

for row in "${FILES[@]}" "${PNG_FILES[@]}"; do dl "${row%%|*}" "${row##*|}"; done

# The 104 app-icon SVGs: names are listed in App-Icons/icon-map.json on Drive
# (folder 1C5Ic8DCH7_Th4zNITObuW0mTnlhX2cwG). Their per-file IDs were captured
# during the Bucket F staging run; re-running this script after a fresh
# connector listing regenerates app-icons/svg/ identically. For brevity the
# 104 IDs live in scripts/v2-app-icon-ids.txt (name=id per line).
if [ -f scripts/v2-app-icon-ids.txt ]; then
  while IFS='=' read -r name id; do
    [ -n "$name" ] && dl "$id" "app-icons/svg/${name}"
  done < scripts/v2-app-icon-ids.txt
fi

python3 - <<'PY'
import hashlib, json, os
root = "assets/v2"
manifest = {}
for base, _, files in os.walk(root):
    for f in files:
        p = os.path.join(base, f)
        rel = os.path.relpath(p, root)
        if rel == "MANIFEST.json":
            continue
        data = open(p, "rb").read()
        manifest[rel] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
with open(os.path.join(root, "MANIFEST.json"), "w") as fh:
    json.dump({"source": "Google Drive brand pack v2", "files": manifest}, fh, indent=1, sort_keys=True)
print(f"MANIFEST.json: {len(manifest)} files")
PY
echo "fetch-v2-assets: done"
