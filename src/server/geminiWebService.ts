/**
 * Real Google Gemini Web Reverse Engineering Client
 * Communicates directly with Google Gemini Web internal endpoints using user session cookies (__Secure-1PSID, __Secure-1PSIDTS)
 * and Google's SNlM0e (at) security token without consuming official Gemini API Key quotas.
 */

export interface GeminiWebSession {
  psid: string;
  psidts?: string;
  psidcc?: string;
  snlm0e?: string;
  email?: string;
  valid: boolean;
  error?: string;
  rawCookie: string;
}

/**
 * Parses user input cookie string into structured cookies
 */
export function parseGoogleCookies(rawCookieStr: string): { psid: string; psidts?: string; psidcc?: string; cleanCookieHeader: string } {
  if (!rawCookieStr || typeof rawCookieStr !== 'string') {
    return { psid: '', cleanCookieHeader: '' };
  }

  const cookieMap = new Map<string, string>();
  const pairs = rawCookieStr.split(';');

  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.substring(0, idx).trim();
      const val = pair.substring(idx + 1).trim();
      if (key && val) {
        cookieMap.set(key, val);
      }
    }
  }

  // Common Google session keys
  const psid = cookieMap.get('__Secure-1PSID') || cookieMap.get('__Secure-3PSID') || cookieMap.get('SID') || '';
  const psidts = cookieMap.get('__Secure-1PSIDTS') || cookieMap.get('__Secure-3PSIDTS') || '';
  const psidcc = cookieMap.get('__Secure-1PSIDCC') || cookieMap.get('__Secure-3PSIDCC') || '';

  // Construct a standard clean cookie header
  const standardPairs: string[] = [];
  cookieMap.forEach((v, k) => {
    standardPairs.push(`${k}=${v}`);
  });

  return {
    psid,
    psidts,
    psidcc,
    cleanCookieHeader: standardPairs.join('; ')
  };
}

/**
 * Authenticates against gemini.google.com with the given session cookies and extracts the real SNlM0e token
 */
export async function validateAndExtractGeminiWebSession(rawCookie: string): Promise<GeminiWebSession> {
  const { psid, cleanCookieHeader } = parseGoogleCookies(rawCookie);

  if (!psid) {
    return {
      psid: '',
      rawCookie,
      valid: false,
      error: 'Không tìm thấy cookie __Secure-1PSID (hoặc SID). Vui lòng kiểm tra lại Cookie đăng nhập từ gemini.google.com.'
    };
  }

  try {
    const response = await fetch('https://gemini.google.com/app', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Cookie': cleanCookieHeader,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    if (!response.ok) {
      return {
        psid,
        rawCookie,
        valid: false,
        error: `Máy chủ Google Gemini Web phản hồi mã lỗi HTTP ${response.status} (${response.statusText}). Cookie có thể đã hết hạn.`
      };
    }

    const html = await response.text();

    // Check if redirected to login page
    if (html.includes('accounts.google.com/signin') || html.includes('ServiceLogin') || html.includes('Sign in - Google Accounts')) {
      return {
        psid,
        rawCookie,
        valid: false,
        error: 'Phiên đăng nhập Google đã hết hạn hoặc Cookie __Secure-1PSID không chính xác.'
      };
    }

    // Extract SNlM0e token (the "at" parameter used in Google Bard / Gemini RPC requests)
    // Matches: "SNlM0e":"..." or ["SNlM0e","..."] or WIZ_global_data = { ... "SNlM0e":"..." }
    const snlm0eMatch = html.match(/"SNlM0e"\s*:\s*"([^"]+)"/) || html.match(/\["SNlM0e"\s*,\s*"([^"]+)"\]/);
    const snlm0e = snlm0eMatch ? snlm0eMatch[1] : undefined;

    // Extract user email if present in WIZ data
    const emailMatch = html.match(/"(?:OGPC|email|user_email|identifier)"\s*:\s*"([^"]+@[^"]+\.[^"]+)"/) ||
                       html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    const email = emailMatch ? emailMatch[1] : undefined;

    if (!snlm0e) {
      // If SNlM0e isn't explicitly extracted from HTML, check if user is blocked or page structure updated
      return {
        psid,
        rawCookie,
        valid: false,
        error: 'Không thể trích xuất mã bảo mật SNlM0e từ trang Gemini Web. Vui lòng đảm bảo bạn đã mở gemini.google.com và lấy đầy đủ cookie.'
      };
    }

    return {
      psid,
      snlm0e,
      email,
      valid: true,
      rawCookie: cleanCookieHeader
    };
  } catch (err: any) {
    return {
      psid,
      rawCookie,
      valid: false,
      error: `Lỗi kết nối tới https://gemini.google.com: ${err.message || 'Lỗi mạng'}`
    };
  }
}

/**
 * Parse Google RPC raw streaming response array
 */
function parseGeminiWebStreamResponse(responseText: string): string {
  if (!responseText || typeof responseText !== 'string') return '';

  const lines = responseText.split('\n');
  let accumulatedText = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(")]}'")) continue;

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        // Look through nested response structure for generated answers
        for (const item of parsed) {
          if (Array.isArray(item) && item[0] === 'wrb.fr') {
            const dataStr = item[2];
            if (typeof dataStr === 'string') {
              try {
                const subData = JSON.parse(dataStr);
                if (Array.isArray(subData) && subData[4]) {
                  const candidateList = subData[4];
                  if (Array.isArray(candidateList) && candidateList[0] && Array.isArray(candidateList[0][1])) {
                    const textParts = candidateList[0][1];
                    if (typeof textParts[0] === 'string') {
                      accumulatedText = textParts[0];
                    }
                  }
                }
              } catch (_) {}
            }
          }
        }
      }
    } catch (_) {}
  }

  return accumulatedText.trim();
}

/**
 * Executes a prompt against Google Gemini Web internal RPC API
 * Endpoint: /_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate
 */
export async function executeGeminiWebPrompt(
  prompt: string,
  session: GeminiWebSession
): Promise<{ success: boolean; text?: string; error?: string }> {
  if (!session.valid || !session.snlm0e) {
    return { success: false, error: session.error || 'Phiên Google Gemini Web chưa hợp lệ' };
  }

  try {
    const reqPayload = [
      null,
      JSON.stringify([
        [prompt, 0, null, null, null, null, 0],
        ['vi'],
        ['', '', ''],
        null,
        null,
        null,
        [1]
      ])
    ];

    const fReq = JSON.stringify(reqPayload);
    const searchParams = new URLSearchParams({
      'bl': 'boq_assistant-bard-web-server_20240305.08_p0',
      '_reqid': String(Math.floor(100000 + Math.random() * 900000)),
      'rt': 'c'
    });

    const bodyParams = new URLSearchParams();
    bodyParams.append('f.req', fReq);
    bodyParams.append('at', session.snlm0e);

    const targetUrl = `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${searchParams.toString()}`;

    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Cookie': session.rawCookie,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Origin': 'https://gemini.google.com',
        'Referer': 'https://gemini.google.com/',
        'X-Same-Domain': '1'
      },
      body: bodyParams.toString()
    });

    if (!res.ok) {
      return {
        success: false,
        error: `Google Gemini Web RPC trả về HTTP ${res.status}: ${res.statusText}`
      };
    }

    const rawResponse = await res.text();
    const extractedText = parseGeminiWebStreamResponse(rawResponse);

    if (!extractedText) {
      // If parsing the structured stream failed, fallback to extracting string payload directly
      const textMatches = rawResponse.match(/\\n\\n([^\\]+)\\n/g);
      if (textMatches && textMatches.length > 0) {
        const last = textMatches[textMatches.length - 1].replace(/\\n/g, '\n').trim();
        if (last.length > 5) {
          return { success: true, text: last };
        }
      }
      return {
        success: false,
        error: 'Không thể phân tích phản hồi từ luồng Gemini Web. Google có thể vừa cập nhật định dạng.'
      };
    }

    return {
      success: true,
      text: extractedText
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Lỗi gửi yêu cầu tới Gemini Web RPC: ${err.message || 'Lỗi mạng'}`
    };
  }
}
