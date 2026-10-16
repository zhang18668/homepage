import { signIn } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import { BiHide, BiLockAlt, BiShieldQuarter, BiShow } from "react-icons/bi";

import styles from "./signin.module.css";

import { getSettings } from "utils/config/config";

const PUBLIC_SIGN_IN_SETTINGS = ["theme", "color", "title", "background", "backgroundOpacity"];
const AUTO_LOGIN_KEY = "homepage-autologin-attempt";
const AUTO_LOGIN_RETRY_MS = 10000;

export default function SignIn({ providers, settings, autoLogin }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const theme = settings?.theme || "dark";
  const color = settings?.color || "slate";
  const callbackUrl = useMemo(() => {
    const value = router.query?.callbackUrl;
    return typeof value === "string" ? value : "/";
  }, [router.query?.callbackUrl]);
  const error = router.query?.error;

  const oidcProvider = useMemo(
    () => Object.values(providers ?? {}).find((provider) => provider.type !== "credentials"),
    [providers],
  );
  // Try to avoid auto-login loop, e.g. if there was an error (or explicitly disabled via query param)
  const autoLoginBlocked = Boolean(error) || router.query?.autologin === "0";
  const redirecting = Boolean(autoLogin && oidcProvider && !autoLoginBlocked);

  const attempted = useRef(false);

  useEffect(() => {
    if (!redirecting || attempted.current) return;
    attempted.current = true;

    let lastAttempt = 0;
    try {
      lastAttempt = Number(window.sessionStorage.getItem(AUTO_LOGIN_KEY)) || 0;
      window.sessionStorage.setItem(AUTO_LOGIN_KEY, String(Date.now()));
    } catch {
      // sessionStorage throws when site data is blocked, fall through and redirect anyway
    }
    // Getting here quickly means the session never stuck, hand it back to the user
    if (Date.now() - lastAttempt < AUTO_LOGIN_RETRY_MS) {
      router.replace(`/auth/signin?autologin=0&callbackUrl=${encodeURIComponent(callbackUrl)}`);
      return;
    }

    signIn(oidcProvider.id, { callbackUrl });
  }, [redirecting, oidcProvider, callbackUrl, router]);

  let backgroundImage = "";
  let opacity = settings?.backgroundOpacity ?? 0;

  if (settings?.background) {
    const bg = settings.background;
    if (typeof bg === "object") {
      backgroundImage = bg.image || "";
      if (bg.opacity !== undefined) {
        opacity = 1 - bg.opacity / 100;
      }
    } else {
      backgroundImage = bg;
    }
  }

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    html.classList.remove("dark", "scheme-dark", "scheme-light");
    html.classList.toggle("dark", theme === "dark");
    html.classList.add(theme === "dark" ? "scheme-dark" : "scheme-light");

    const desiredThemeClass = `theme-${color}`;
    const themeClassesToRemove = Array.from(html.classList).filter(
      (cls) => cls.startsWith("theme-") && cls !== desiredThemeClass,
    );
    if (themeClassesToRemove.length) {
      html.classList.remove(...themeClassesToRemove);
    }
    if (!html.classList.contains(desiredThemeClass)) {
      html.classList.add(desiredThemeClass);
    }

    body.style.backgroundImage = "";
    body.style.backgroundColor = "";
    body.style.backgroundAttachment = "";
  }, [color, theme]);

  const providerList = Object.values(providers ?? {});
  const passwordProvider = providerList.find((provider) => provider.type === "credentials");
  const externalProviders = providerList.filter((provider) => provider.type !== "credentials");

  return (
    <>
      {backgroundImage && (
        <div
          id="background"
          aria-hidden="true"
          style={{
            backgroundImage: `linear-gradient(rgb(var(--bg-color) / ${opacity}), rgb(var(--bg-color) / ${opacity})), url('${backgroundImage}')`,
          }}
        />
      )}
      <main className={styles.page}>
        <div className={styles.ambient} aria-hidden="true" />
        <div className={styles.content}>
          <header className={styles.brand}>
            <div className={styles.brandMark} aria-hidden="true">
              <span>[</span>
              <span className={styles.brandCore}>✦</span>
              <span>]</span>
            </div>
            <h1>晨风工作台登录</h1>
          </header>
          <section className={styles.card} aria-label="晨风工作台登录">
            <div className={styles.cardHeading}>
              <div className={styles.lockMark} aria-hidden="true">
                <BiLockAlt />
              </div>
              <div>
                <h2>登录晨风工作台</h2>
                <p>{passwordProvider ? "输入密码以继续访问" : "使用单点登录继续访问"}</p>
              </div>
            </div>
            {providerList.length === 0 ? (
              <div className={styles.message} role="alert">
                <BiShieldQuarter aria-hidden="true" /> 登录服务暂不可用，请联系管理员。
              </div>
            ) : redirecting ? (
              <p className={styles.message}>正在跳转至单点登录服务…</p>
            ) : (
              <div className={styles.actions}>
                {passwordProvider && (
                  <form
                    className={styles.form}
                    onSubmit={async (event) => {
                      event.preventDefault();
                      await signIn(passwordProvider.id, { redirect: true, callbackUrl, password });
                    }}
                  >
                    <div className={styles.passwordField}>
                      <input
                        type={showPassword ? "text" : "password"}
                        name="password"
                        aria-label="密码"
                        placeholder="密码"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="current-password"
                        required
                      />
                      <button
                        className={styles.visibility}
                        type="button"
                        aria-label={showPassword ? "隐藏密码" : "显示密码"}
                        onClick={() => setShowPassword((visible) => !visible)}
                      >
                        {showPassword ? <BiHide /> : <BiShow />}
                      </button>
                    </div>
                    <button className={styles.primaryButton} type="submit">
                      登录
                    </button>
                  </form>
                )}
                {externalProviders.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => signIn(provider.id, { callbackUrl })}
                    className={styles.primaryButton}
                  >
                    {externalProviders.length === 1 ? "单点登录" : `使用${provider.name}登录`}
                  </button>
                ))}
                {error && (
                  <p className={styles.error} role="alert">
                    登录失败，请检查凭据后重试。
                  </p>
                )}
              </div>
            )}
          </section>
          <p className={styles.footer}>安全访问 · 晨风工作台</p>
        </div>
      </main>
    </>
  );
}

export async function getServerSideProps(context) {
  // Avoid getProviders() fetch
  let providers = {};
  try {
    // Dynamic so a bad config throws in here rather than at page load
    const { authOptions } = await import("pages/api/auth/[...nextauth]");
    providers = Object.fromEntries(authOptions.providers.map(({ id, name, type }) => [id, { id, name, type }]));
  } catch (e) {
    console.error("Unable to load auth providers: %s", e.message);
  }

  const homepageSettings = getSettings();
  const settings = Object.fromEntries(
    PUBLIC_SIGN_IN_SETTINGS.filter((key) => Object.prototype.hasOwnProperty.call(homepageSettings, key)).map((key) => [
      key,
      homepageSettings[key],
    ]),
  );
  return {
    props: { providers, settings, autoLogin: process.env.HOMEPAGE_OIDC_AUTO_LOGIN === "true" },
  };
}
