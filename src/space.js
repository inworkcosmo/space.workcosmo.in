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
import {
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

  root
    .querySelectorAll("[data-launch-module]:not([aria-disabled='true'])")
    .forEach((button) => {
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
    const {
      collection,
      query,
      where,
      limit,
      getDocs,
      setDoc,
      serverTimestamp,
    } = await import("./firebase.js");
    const q = query(
      collection(db, "users"),
      where("email", "==", user.email),
      limit(1),
    );
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      const docSnap = querySnapshot.docs[0];
      const data = docSnap.data();

      // Auto-fix misaligned document by cloning it to the correct UID path
      try {
        await setDoc(userRef, {
          ...data,
          userId: user.uid,
          updatedAt: serverTimestamp(),
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
  const companyDisplayName =
    company?.companyName || company?.name || "Workcosmo Workspace";
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
  document.querySelector(".dashboard-dock")?.classList.remove("hidden");
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
  initWorkspace(user, profile, company);
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
    document.querySelector(".dashboard-dock")?.classList.add("hidden");
    els.loginView.classList.remove("hidden");
    teardownWorkspace();
  }
});

/* ─────────────────────────────────────────────
   Workspace Features
───────────────────────────────────────────── */

let _chatUnsub = null;
let _currentProfile = null;
let _currentCompanyId = null;

function teardownWorkspace() {
  if (_chatUnsub) {
    _chatUnsub();
    _chatUnsub = null;
  }
}

function formatTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ── Group Chat ── */

function initGroupChat(companyId, currentUserId) {
  const messagesEl = document.getElementById("chat-messages");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  if (!messagesEl || !chatForm) return;

  // Show empty state initially
  messagesEl.innerHTML = `
    <div class="chat-empty">
      <i class="fas fa-comments"></i>
      <p>No messages yet. Say hello to your team!</p>
    </div>`;

  const chatRef = collection(db, "workspaceChats");
  const q = query(
    chatRef,
    where("companyId", "==", companyId),
    orderBy("createdAt", "asc"),
    limit(80),
  );

  _chatUnsub = onSnapshot(q, (snapshot) => {
    const companyMsgs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (companyMsgs.length === 0) {
      messagesEl.innerHTML = `
        <div class="chat-empty">
          <i class="fas fa-comments"></i>
          <p>No messages yet. Say hello to your team!</p>
        </div>`;
      return;
    }

    messagesEl.innerHTML = companyMsgs
      .map((msg) => {
        const isOwn = msg.senderId === currentUserId;
        const senderLabel = isOwn
          ? "You"
          : msg.senderName || msg.senderEmail || "Teammate";
        return `
        <div class="chat-msg ${isOwn ? "own" : ""}">
          <div class="msg-avatar"><i class="fas fa-user-circle"></i></div>
          <div class="msg-content">
            <span class="chat-msg-meta">${senderLabel}</span>
            <div class="chat-bubble">${escapeHtml(msg.text)}</div>
            <span class="msg-time">${formatTime(msg.createdAt)} ${isOwn ? '<i class="fas fa-check-double text-blue-500"></i>' : ""}</span>
          </div>
        </div>`;
      })
      .join("");

    messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = "";
    chatInput.disabled = true;

    try {
      await addDoc(collection(db, "workspaceChats"), {
        companyId,
        senderId: currentUserId,
        senderName: _currentProfile?.name || _currentProfile?.displayName || "",
        senderEmail: _currentProfile?.email || "",
        text,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("Chat send failed:", err);
    } finally {
      chatInput.disabled = false;
      chatInput.focus();
    }
  });
}

function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── AI Support Assistant ── */

const SUPPORT_KNOWLEDGE = [
  {
    keywords: [
      "hi",
      "hello",
      "hey",
      "greetings",
      "good morning",
      "good afternoon",
      "good evening",
      "howdy",
      "sup",
    ],
    answer:
      "👋 Hello! I'm your Workcosmo AI Support Assistant. I can help answer common questions about billing, client IDs, module launches, user invites, password resets, and performance issues. What can I help you with today?",
  },
  {
    keywords: [
      "reset",
      "password",
      "forgot",
      "login",
      "signin",
      "sign in",
      "credential",
      "lockout",
    ],
    answer:
      "🔑 To reset your password, click the 'Send password reset' option on the login screen, enter your email, and follow the link sent to your inbox.",
  },
  {
    keywords: [
      "module",
      "launch",
      "product",
      "hire",
      "core",
      "perform",
      "app",
      "dashboard",
    ],
    answer:
      "🚀 You can launch modules (Hire, Core, Perform, AI) by clicking their corresponding active icons in the floating dock at the bottom of your dashboard.",
  },
  {
    keywords: [
      "account",
      "inactive",
      "blocked",
      "provisioned",
      "not active",
      "disable",
      "suspend",
    ],
    answer:
      "⚠️ If your account status is inactive or suspended, please request your workspace administrator to reactivate your profile in the Admin Console.",
  },
  {
    keywords: ["client id", "company id", "tenant", "workspace id", "slug"],
    answer:
      "🆔 Your Client ID is a unique workspace identifier assigned to your company. If you don't know it, check your onboarding email or ask your system administrator.",
  },
  {
    keywords: [
      "billing",
      "payment",
      "invoice",
      "subscription",
      "price",
      "plan",
      "upgrade",
      "pay",
    ],
    answer:
      "💳 Billing settings, subscriptions, and upgrades are managed by company owners. You can also contact our billing desk directly by raising a ticket here.",
  },
  {
    keywords: [
      "slow",
      "loading",
      "performance",
      "lag",
      "freeze",
      "crash",
      "buffering",
    ],
    answer:
      "⚡ For speed issues, try refreshing your browser, clearing temporary cookies, or using Google Chrome. If it persists, let us know by raising a support ticket.",
  },
  {
    keywords: [
      "user",
      "invite",
      "add user",
      "add member",
      "create user",
      "new user",
      "provision",
    ],
    answer:
      "👤 System administrators can invite and manage workspace users directly from the access.workcosmo.in portal.",
  },
  {
    keywords: [
      "error",
      "bug",
      "broken",
      "not working",
      "issue",
      "fault",
      "defect",
    ],
    answer:
      "🛠️ Sorry to hear that! Please describe the error in detail. If we can't resolve it here, you can click the ticket icon (🎫) inside the message input bar to submit an investigation request.",
  },
  {
    keywords: [
      "help",
      "ticket",
      "human",
      "agent",
      "support",
      "raise",
      "contact",
      "support ticket",
    ],
    answer:
      "🎫 You can raise a support ticket anytime by clicking the ticket icon (🎫) in the support chat composer. Fill out the subject and details, and our team will get right on it!",
  },
  {
    keywords: [
      "thanks",
      "thank you",
      "thanks!",
      "awesome",
      "perfect",
      "ok",
      "okay",
    ],
    answer:
      "😊 You're welcome! Let me know if you need help with anything else.",
  },
];

function getSupportAnswer(question) {
  const q = question.toLowerCase().trim();
  if (!q) return null;
  for (const entry of SUPPORT_KNOWLEDGE) {
    if (entry.keywords.some((k) => q.includes(k) || k.includes(q))) {
      return entry.answer;
    }
  }
  return null;
}

function appendSupportMsg(role, text) {
  const chat = document.getElementById("support-ai-messages");
  if (!chat) return;
  const div = document.createElement("div");
  div.className = `support-msg ${role}`;
  div.innerHTML = `<p>${escapeHtml(text)}</p>`;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function initSupportAgent() {
  const sendBtn = document.getElementById("support-ai-send");
  const input = document.getElementById("support-ai-input");
  const ticketBtn = document.getElementById("btn-ticket-trigger");
  const cancelBtn = document.getElementById("btn-cancel-ticket");
  const ticketFormOverlay = document.getElementById("support-ticket-form");
  const composer = document.getElementById("support-composer");
  if (!sendBtn || !input) return;

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";

    appendSupportMsg("user", text);

    // Thinking indicator
    const thinkingDiv = appendSupportMsg(
      "thinking",
      "Workcosmo Support is thinking…",
    );

    await new Promise((r) => setTimeout(r, 700));

    const answer = getSupportAnswer(text);
    if (thinkingDiv) thinkingDiv.remove();

    if (answer) {
      appendSupportMsg("assistant", answer);
      appendSupportMsg(
        "assistant",
        "Did that help? If not, feel free to raise a support ticket — our team will assist you directly.",
      );
    } else {
      appendSupportMsg(
        "assistant",
        "I'm not sure about that one. Would you like to raise a support ticket so our team can help you directly?",
      );
    }
  }

  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  // Show ticket form
  if (ticketBtn && ticketFormOverlay && composer) {
    ticketBtn.addEventListener("click", () => {
      ticketFormOverlay.classList.remove("hidden");
      composer.classList.add("hidden");
    });
  }

  // Cancel ticket
  if (cancelBtn && ticketFormOverlay && composer) {
    cancelBtn.addEventListener("click", () => {
      ticketFormOverlay.classList.add("hidden");
      composer.classList.remove("hidden");
    });
  }
}

/* ── Ticket Submission ── */

function initTicketForm(profile, companyId) {
  const form = document.getElementById("ticket-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const subject = document.getElementById("ticket-subject")?.value.trim();
    const desc = document.getElementById("ticket-desc")?.value.trim();
    if (!subject || !desc) return;

    const submitBtn = form.querySelector("button[type='submit']");
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";

    try {
      await addDoc(collection(db, "supportTickets"), {
        companyId,
        subject,
        description: desc,
        status: "Open",
        submittedBy: {
          uid: auth.currentUser?.uid || "",
          name: profile?.name || profile?.displayName || "",
          email: profile?.email || auth.currentUser?.email || "",
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // Show success state
      const overlay = document.getElementById("support-ticket-form");
      overlay.innerHTML = `
        <div class="ticket-success">
          <i class="fas fa-circle-check"></i>
          <h5>Ticket Submitted!</h5>
          <p>Your ticket has been received. Our support team will follow up via email.</p>
          <button type="button" class="btn-secondary" id="btn-close-success">Done</button>
        </div>`;

      document
        .getElementById("btn-close-success")
        ?.addEventListener("click", () => {
          window.location.reload();
        });
    } catch (err) {
      console.error("Ticket submission failed:", err);
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Ticket";
      alert("Failed to submit ticket. Please try again.");
    }
  });
}

/* ── Contact Channel Switching ── */

function initChannelSwitcher() {
  const contacts = document.querySelectorAll(".contact-item");
  contacts.forEach((contact) => {
    contact.addEventListener("click", () => {
      // Toggle active contact
      contacts.forEach((c) => c.classList.remove("active"));
      contact.classList.add("active");

      // Toggle active pane
      const channel = contact.dataset.channel;
      document.querySelectorAll(".channel-pane").forEach((pane) => {
        pane.classList.remove("active");
      });
      document.getElementById(`channel-${channel}`)?.classList.add("active");
    });
  });

  // Tab switching logic for the sidebar
  const tabs = document.querySelectorAll(".sidebar-tabs .tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
    });
  });
}

/* ── Init Workspace (called after login) ── */

function initWorkspace(user, profile, company) {
  _currentProfile = profile;
  _currentCompanyId = company.id || company.companyId;

  initGroupChat(_currentCompanyId, user.uid);
  initSupportAgent();
  initTicketForm(profile, _currentCompanyId);
  initChannelSwitcher();

  const chatModal = document.getElementById("chat-modal");

  document.getElementById("show-chat-btn")?.addEventListener("click", () => {
    chatModal?.classList.remove("hidden");
    // Scroll active chat messages to bottom on open
    const activeMessages = document.querySelector(
      ".channel-pane.active .chat-messages",
    );
    if (activeMessages) {
      activeMessages.scrollTop = activeMessages.scrollHeight;
    }
  });

  document.getElementById("close-chat-btn")?.addEventListener("click", () => {
    chatModal?.classList.add("hidden");
  });
}
