// 离线卡密验证(Ed25519)。插件只内置【公钥】,私钥在作者手里,绝不进仓库。
// 卡密格式: NBP1.<base64url(payloadJSON)>.<base64url(签名)>
// payload: { id: string, iat: number, exp: number }。库存卡可能在售出前签发，
// 所以最终有效期由服务器根据付款记录校验；插件只离线验证卡密确属本产品。
import { createPublicKey, verify as cryptoVerify } from "crypto";

// 作者公钥(spki der, base64)。换密钥对时改这里。
const PUBLIC_KEY_B64 = "MCowBQYDK2VwAyEAxp8Vp4aptQeFPCIWAKQy2NZ+oWccg8vjo+PWEaXxbo0=";

export interface LicensePayload {
  id: string;
  iat: number;
  exp: number;
}

export interface LicenseResult {
  valid: boolean;
  reason?: string;
  payload?: LicensePayload;
}

function b64uToBuf(s: string): Buffer {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Buffer.from(t, "base64");
}

export function verifyLicense(card: string): LicenseResult {
  if (!card || !card.trim()) return { valid: false, reason: "未填卡密" };
  const parts = card.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "NBP1") return { valid: false, reason: "卡密格式不对" };

  let payloadBytes: Buffer, sig: Buffer;
  try {
    payloadBytes = b64uToBuf(parts[1]);
    sig = b64uToBuf(parts[2]);
  } catch {
    return { valid: false, reason: "卡密损坏" };
  }

  let ok = false;
  try {
    const pub = createPublicKey({ key: Buffer.from(PUBLIC_KEY_B64, "base64"), format: "der", type: "spki" });
    ok = cryptoVerify(null, payloadBytes, pub, sig);
  } catch {
    return { valid: false, reason: "验证出错" };
  }
  if (!ok) return { valid: false, reason: "卡密无效(签名不符)" };

  let payload: LicensePayload;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    return { valid: false, reason: "卡密损坏" };
  }
  return { valid: true, payload };
}

// 给设置页用的人类可读状态。
export function licenseStatusText(card: string): string {
  if (!card || !card.trim()) return "未激活(公众号付款后获得卡密)";
  const r = verifyLicense(card);
  if (!r.valid) return "❌ " + (r.reason ?? "无效");
  return "✅ 已激活（有效期以服务器付款记录为准）";
}
