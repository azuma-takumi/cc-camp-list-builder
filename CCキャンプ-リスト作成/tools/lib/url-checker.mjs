function normalizeUrl(rawValue) {
  const value = String(rawValue || "").trim();

  if (!value) {
    return { normalized: "", changed: false };
  }

  if (/^https?:\/\//i.test(value)) {
    return { normalized: value, changed: false };
  }

  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) {
    return { normalized: `https://${value}`, changed: true };
  }

  return { normalized: value, changed: false };
}

function isYoutubeUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)youtube\.com$/i.test(parsed.hostname) || /(^|\.)youtu\.be$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

async function fetchOnce(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "cc-camp-list-builder/1.0",
      },
    });

    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url || url,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function validateAndRepairUrl(rawValue) {
  const logs = [];
  const { normalized, changed } = normalizeUrl(rawValue);

  if (!normalized) {
    return {
      status: "skip",
      finalValue: "",
      logs: ["URLが空のためスキップ"],
    };
  }

  let workingUrl = normalized;
  if (changed) {
    logs.push(`https を補完: ${workingUrl}`);
  }

  // YouTube はアクセス制御で単純な到達判定が不安定なため、
  // 形式が整っていればエラー扱いにしない。
  if (isYoutubeUrl(workingUrl)) {
    logs.push("YouTube URL は形式確認のみ実施");
    return {
      status: changed ? "fixed" : "ok",
      finalValue: workingUrl,
      logs,
    };
  }

  try {
    const first = await fetchOnce(workingUrl);
    logs.push(`初回チェック: ${first.status} ${first.finalUrl}`);

    if (first.ok) {
      return {
        status: changed ? "fixed" : "ok",
        finalValue: first.finalUrl,
        logs,
      };
    }

    if (workingUrl.startsWith("https://")) {
      const fallbackUrl = workingUrl.replace(/^https:\/\//i, "http://");
      logs.push(`https 失敗のため http を再試行: ${fallbackUrl}`);
      const retry = await fetchOnce(fallbackUrl);
      logs.push(`再試行結果: ${retry.status} ${retry.finalUrl}`);

      if (retry.ok) {
        return {
          status: "fixed",
          finalValue: retry.finalUrl,
          logs,
        };
      }
    }

    return {
      status: "error",
      finalValue: workingUrl,
      logs,
    };
  } catch (error) {
    logs.push(`通信エラー: ${error.name} ${error.message}`);

    if (workingUrl.startsWith("https://")) {
      const fallbackUrl = workingUrl.replace(/^https:\/\//i, "http://");
      logs.push(`通信エラーのため http を再試行: ${fallbackUrl}`);

      try {
        const retry = await fetchOnce(fallbackUrl);
        logs.push(`再試行結果: ${retry.status} ${retry.finalUrl}`);

        if (retry.ok) {
          return {
            status: "fixed",
            finalValue: retry.finalUrl,
            logs,
          };
        }
      } catch (retryError) {
        logs.push(`再試行エラー: ${retryError.name} ${retryError.message}`);
      }
    }

    return {
      status: "error",
      finalValue: workingUrl,
      logs,
    };
  }
}
