(() => {
  "use strict";

  const title = document.querySelector("#confirmation-title");
  const message = document.querySelector("#confirmation-message");
  const indicator = document.querySelector("#confirmation-indicator");
  const action = document.querySelector("#confirmation-action");

  function showState(state, description) {
    const success = state === "success";
    title.textContent = success ? "Correo confirmado" : "No se pudo confirmar";
    message.textContent = description;
    indicator.classList.toggle("is-error", !success);
    action.hidden = false;
  }

  function clearAuthTokensFromUrl() {
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  async function confirmEmail() {
    const url = new URL(window.location.href);
    const query = url.searchParams;
    const hash = new URLSearchParams(url.hash.slice(1));
    const type = query.get("type") || hash.get("type") || "";
    const tokenHash = query.get("token_hash");
    const authError = query.get("error_description") || hash.get("error_description") ||
      query.get("error") || hash.get("error");

    if (authError) {
      clearAuthTokensFromUrl();
      showState("error", "El enlace no es válido o ya venció. Solicita un nuevo correo de confirmación e inténtalo otra vez.");
      return;
    }

    if (!window.supabase?.createClient || !window.GANADERO_CONFIG?.supabaseUrl ||
        !window.GANADERO_CONFIG?.supabaseAnonKey) {
      showState("error", "No pudimos conectar con el servicio de autenticación. Revisa tu conexión e inténtalo de nuevo.");
      return;
    }

    if (type !== "signup" && type !== "email" && !tokenHash) {
      showState("error", "Este enlace no corresponde a una confirmación de registro. Abre el enlace más reciente que recibiste por correo.");
      return;
    }

    try {
      const client = window.supabase.createClient(
        window.GANADERO_CONFIG.supabaseUrl,
        window.GANADERO_CONFIG.supabaseAnonKey
      );

      if (tokenHash) {
        const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: type || "signup" });
        if (error) throw error;
      }

      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      clearAuthTokensFromUrl();

      if (!data.session) {
        showState("error", "No encontramos una sesión de confirmación válida. El enlace quizá ya venció; solicita uno nuevo e inténtalo otra vez.");
        return;
      }

      showState("success", "Tu correo quedó verificado y tu cuenta ya está lista. Continúa para entrar a Ganaderov.");
    } catch (error) {
      console.error("No se pudo confirmar el correo de Ganaderov.", error);
      clearAuthTokensFromUrl();
      showState("error", "El enlace no se pudo validar o ya venció. Solicita un nuevo correo de confirmación e inténtalo otra vez.");
    }
  }

  confirmEmail();
})();
