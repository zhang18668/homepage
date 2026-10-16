// Service navigation account controls. Identity comes from the trusted Authentik forward-auth response.
(() => {
  function decodeHeader(value) {
    if (!value) return "";
    if (Array.from(value).some((character) => character.charCodeAt(0) > 255)) return value;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(value, (character) => character.charCodeAt(0))
      );
    } catch {
      return value;
    }
  }

  async function showAccount() {
    let response;
    try {
      response = await fetch("/__homepage_account", { credentials: "same-origin", cache: "no-store" });
    } catch {
      return;
    }
    if (!response.ok) return;

    const username = decodeHeader(response.headers.get("X-Homepage-User-Username"))?.trim();
    const displayName = decodeHeader(response.headers.get("X-Homepage-User-Name"))?.trim() || username;
    const email = decodeHeader(response.headers.get("X-Homepage-User-Email"))?.trim().toLowerCase();
    if (email === "894218668@qq.com") document.body.classList.add("homepage-admin");
    if (!displayName) return;

    const mount = () => {
      const header = document.getElementById("information-widgets");
      if (!header) return false;
      if (document.getElementById("homepage-user-controls")) return true;

      const controls = document.createElement("div");
      controls.id = "homepage-user-controls";
      controls.setAttribute("aria-label", "\u5f53\u524d\u7528\u6237");

      const identity = document.createElement("div");
      identity.className = "homepage-user-identity";

      const avatar = document.createElement("span");
      avatar.className = "homepage-user-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.textContent = Array.from(displayName)[0]?.toLocaleUpperCase() || "\u4eba";

      const name = document.createElement("span");
      name.className = "homepage-user-name";
      name.textContent = displayName;

      identity.append(avatar, name);

      const logout = document.createElement("a");
      logout.className = "homepage-user-logout";
      logout.href = "https://auth.zhangzhh13.xyz/outpost.goauthentik.io/sign_out";
      logout.textContent = "\u9000\u51fa\u767b\u5f55";
      logout.setAttribute("aria-label", "\u9000\u51fa\u767b\u5f55");

      controls.append(identity, logout);
      header.append(controls);
      return true;
    };

    if (mount()) return;
    const observer = new MutationObserver(() => {
      if (mount()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 10000);
  }

  showAccount();
})();
