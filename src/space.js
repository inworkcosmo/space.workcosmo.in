import {
  auth,
  db,
  doc,
  getDoc,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "./firebase.js";
import {
  WORKCOSMO_MODULES,
  buildModuleUrl,
  isModuleEnabled,
  normalizeClientId,
} from "./modules.js";

const els = {
  loginView: document.getElementById("login-view"),
  dashboardView: document.getElementById("dashboard-view"),
  loginForm: document.getElementById("login-form"),
  clientId: document.getElementById("client-id"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  error: document.getElementById("login-error"),
  resetBtn: document.getElementById("reset-password"),
  signOutBtn: document.getElementById("sign-out"),
  companyNameCard: document.getElementById("company-name-card"),
  userEmail: document.getElementById("user-email"),
  greeting: document.getElementById("greeting"),
  welcomeTitle: document.getElementById("welcome-title"),
  status: document.getElementById("status"),
  statusStat: document.getElementById("status-stat"),
  modulesCount: document.getElementById("modules-count"),
  modulesDock: document.getElementById("modules-dock"),
};

function setError(message = "") {
  els.error.textContent = message;
  els.error.classList.toggle("hidden", !message);
}

function displayName(user, profile) {
  return (
    profile?.name ||
    profile?.displayName ||
    user?.displayName ||
    user?.email?.split("@")[0] ||
    "User"
  );
}

function greetingForHour(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatLabel(value = "") {
  return value
    .toString()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function countEnabledModules(company) {
  return WORKCOSMO_MODULES.filter(
    (mod) => isModuleEnabled(company, mod.key) && mod.status === "live",
  ).length;
}

async function launchModule(button, moduleKey, cid) {
  try {
    button.style.pointerEvents = "none";
    button.style.opacity = "0.7";

    const user = auth.currentUser;
    if (!user) {
      throw new Error("No active session in Space");
    }

    const idToken = await user.getIdToken(true);
    const url = buildModuleUrl(moduleKey, cid, idToken);
    window.open(url, "_blank");
    setTimeout(() => {
      button.style.pointerEvents = "";
      button.style.opacity = "";
    }, 1000);
  } catch (err) {
    console.error("SSO launch failed:", err);
    button.style.pointerEvents = "";
    button.style.opacity = "";
    window.open(buildModuleUrl(moduleKey, cid), "_blank");
  }
}

function bindModuleLaunchers(root, cid) {
  root.querySelectorAll("[aria-disabled='true']").forEach((button) => {
    button.addEventListener("click", (event) => event.preventDefault());
  });

  root.querySelectorAll("[data-launch-module]:not([aria-disabled='true'])").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      const moduleKey = button.getAttribute("data-launch-module");
      if (!moduleKey) return;
      await launchModule(button, moduleKey, cid);
    });
  });
}

async function loadUserProfile(user) {
  try {
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      return { id: snap.id, ...snap.data() };
    }

    // Fallback: Handle misaligned UIDs by querying by email
    const { collection, query, where, limit, getDocs, setDoc, serverTimestamp } = await import("./firebase.js");
    const q = query(collection(db, "users"), where("email", "==", user.email), limit(1));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const docSnap = querySnapshot.docs[0];
      const data = docSnap.data();

      // Auto-fix misaligned document by cloning it to the correct UID path
      try {
        await setDoc(userRef, {
          ...data,
          userId: user.uid,
          updatedAt: serverTimestamp()
        });
      } catch (fixErr) {
        console.warn("Auto-fix misaligned UID failed:", fixErr);
      }

      return { id: user.uid, ...data };
    }
  } catch (err) {
    console.warn("Could not load user profile:", err);
  }
  return null;
}

async function loadCompany(companyId) {
  const cid = normalizeClientId(companyId);
  if (!cid) return null;
  const snap = await getDoc(doc(db, "companies", cid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function renderModules(company) {
  const cid = normalizeClientId(
    company?.companyId ||
      company?.clientId ||
      company?.subdomain ||
      company?.id ||
      "",
  );

  els.modulesDock.innerHTML = WORKCOSMO_MODULES.map((mod) => {
    const enabled = isModuleEnabled(company, mod.key);
    const live = enabled && mod.status === "live";
    const disabledClass = live ? "" : " disabled";
    const disabledAttr = live ? "" : ' aria-disabled="true"';
    const href = live ? buildModuleUrl(mod.key, cid) : "#";

    return `
      <a class="dock-module${disabledClass}" href="${href}"${disabledAttr} data-launch-module="${mod.key}" data-module="${mod.key}" title="${mod.label}">
        <i class="fas ${mod.icon}"></i>
        <span class="dock-module-label">${mod.label}</span>
      </a>
    `;
  }).join("");

  bindModuleLaunchers(els.modulesDock, cid);
}

function renderDashboard(user, profile, company) {
  const companyDisplayName = company?.companyName || company?.name || "Workcosmo Workspace";
  const name = displayName(user, profile);
  const status = formatLabel(company?.status || "active");
  const enabledCount = countEnabledModules(company);

  els.greeting.textContent = greetingForHour();
  els.welcomeTitle.textContent = `Welcome back, ${name.split(" ")[0]}`;
  els.companyNameCard.textContent = companyDisplayName;
  els.userEmail.textContent = user.email || profile?.email || "";
  els.status.textContent = status;
  els.statusStat.textContent = status;
  els.modulesCount.textContent = String(enabledCount);

  renderModules(company);

  els.loginView.classList.add("hidden");
  els.dashboardView.classList.remove("hidden");
}

async function handleSignedIn(user) {
  setError("");
  const profile = await loadUserProfile(user);
  if (!profile || profile.status !== "active") {
    setError(
      "Your account is inactive or not provisioned. Contact your administrator.",
    );
    await signOut(auth);
    return;
  }

  const profileCompanyId = normalizeClientId(
    profile.companyId || profile.clientId || profile.subdomain,
  );
  const requested = normalizeClientId(
    sessionStorage.getItem("tenant_client_id") ||
      els.clientId.value ||
      profileCompanyId,
  );
  if (!profileCompanyId || (requested && requested !== profileCompanyId)) {
    sessionStorage.removeItem("tenant_client_id");
    setError("Client ID does not match this login.");
    await signOut(auth);
    return;
  }

  const company = await loadCompany(profileCompanyId);
  if (!company || company.status !== "active") {
    setError("Workspace is inactive or unavailable.");
    await signOut(auth);
    return;
  }

  sessionStorage.setItem("tenant_client_id", profileCompanyId);
  renderDashboard(user, profile, company);
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setError("");
  const clientId = normalizeClientId(els.clientId.value);
  const email = els.email.value.trim();
  const password = els.password.value;
  if (!clientId || !email || !password) {
    setError("Enter Client ID, email, and password.");
    return;
  }

  const submit = els.loginForm.querySelector("button[type='submit']");
  const original = submit.textContent;
  submit.disabled = true;
  submit.textContent = "Entering Space...";
  try {
    sessionStorage.setItem("tenant_client_id", clientId);
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    sessionStorage.removeItem("tenant_client_id");
    setError(error.message || "Sign in failed.");
  } finally {
    submit.disabled = false;
    submit.textContent = original;
  }
});

els.resetBtn.addEventListener("click", async () => {
  const email = els.email.value.trim();
  if (!email) {
    setError("Enter your email first, then request a reset link.");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    setError("Password reset email sent. Check your inbox.");
  } catch (error) {
    setError(error.message || "Could not send reset email.");
  }
});

els.signOutBtn.addEventListener("click", async () => {
  await signOut(auth);
});

// Pre-fill Client ID from URL query parameters or sessionStorage on load
function prefillClientId() {
  const params = new URLSearchParams(window.location.search);
  const keys = ["companyId", "company", "cid", "clientId", "subdomain"];
  let cid = "";
  for (const key of keys) {
    cid = params.get(key);
    if (cid) break;
  }
  if (!cid) {
    cid = sessionStorage.getItem("tenant_client_id") || "";
  }
  if (cid) {
    const normalized = normalizeClientId(cid);
    if (normalized) {
      els.clientId.value = normalized;
      sessionStorage.setItem("tenant_client_id", normalized);
    }
  }
}

// Call on load
prefillClientId();

onAuthStateChanged(auth, async (user) => {
  if (user && !user.isAnonymous) {
    try {
      await handleSignedIn(user);
    } catch (error) {
      console.error(error);
      setError("Could not load your Space. Try again.");
      await signOut(auth);
    }
  } else {
    els.dashboardView.classList.add("hidden");
    els.loginView.classList.remove("hidden");
  }
});
