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
  companyName: document.getElementById("company-name"),
  companyId: document.getElementById("company-id"),
  userName: document.getElementById("user-name"),
  userEmail: document.getElementById("user-email"),
  userRole: document.getElementById("user-role"),
  plan: document.getElementById("plan"),
  status: document.getElementById("status"),
  modulesGrid: document.getElementById("modules-grid"),
  poweredBy: document.getElementById("powered-by"),
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
  els.modulesGrid.innerHTML = WORKCOSMO_MODULES.map((mod) => {
    const enabled = isModuleEnabled(company, mod.key);
    const live = enabled && mod.status === "live";
    const href = live ? buildModuleUrl(mod.key, cid) : "#";
    const stateLabel = live
      ? "Launch"
      : enabled
        ? "Coming soon"
        : "Not enabled";
    const disabledClass = live ? "" : " module-card-disabled";
    const disabledAttr = live ? "" : ' aria-disabled="true"';

    return `
            <a class="module-card${disabledClass}" href="${href}"${disabledAttr} data-module="${mod.key}">
                <span class="module-icon"><i class="fas ${mod.icon}"></i></span>
                <span class="module-copy">
                    <strong>${mod.productName}</strong>
                    <small>${mod.description}</small>
                </span>
                <span class="module-state">${stateLabel}</span>
            </a>
        `;
  }).join("");

  els.modulesGrid.querySelectorAll("[aria-disabled='true']").forEach((card) => {
    card.addEventListener("click", (event) => event.preventDefault());
  });

  els.modulesGrid.querySelectorAll(".module-card:not([aria-disabled='true'])").forEach((card) => {
    card.addEventListener("click", async (event) => {
      event.preventDefault();
      const moduleKey = card.getAttribute("data-module");
      const label = card.querySelector(".module-state");
      const originalText = label.textContent;

      try {
        label.textContent = "Launching...";
        card.style.pointerEvents = "none";

        const user = auth.currentUser;
        if (!user) {
          throw new Error("No active session in Space");
        }

        // Fetch fresh ID token
        const idToken = await user.getIdToken(true);

        // Build URL with SSO token query parameter
        const url = buildModuleUrl(moduleKey, cid, idToken);

        // Open in new tab
        window.open(url, "_blank");
        setTimeout(() => {
          label.textContent = originalText;
          card.style.pointerEvents = "";
        }, 1000);
      } catch (err) {
        console.error("SSO launch failed:", err);
        label.textContent = originalText;
        card.style.pointerEvents = "";
        // Fallback: open in new tab without SSO token
        window.open(buildModuleUrl(moduleKey, cid), "_blank");
      }
    });
  });
}

function renderDashboard(user, profile, company) {
  const cid = normalizeClientId(
    company?.companyId || profile?.companyId || company?.id || "",
  );
  els.companyName.textContent =
    company?.companyName || company?.name || "Workcosmo Workspace";
  els.companyId.textContent = cid || "workspace";
  els.userName.textContent = displayName(user, profile);
  els.userEmail.textContent = user.email || profile?.email || "";
  els.userRole.textContent = profile?.role || "member";
  els.plan.textContent = company?.plan || "starter";
  els.status.textContent = company?.status || "active";
  els.poweredBy.textContent = "Powered by Workcosmo";
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
