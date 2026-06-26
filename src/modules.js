export const WORKCOSMO_MODULES = Object.freeze([
  {
    key: "hire",
    productName: "Workcosmo Hire",
    shortName: "CosmoHire",
    label: "Hire",
    description:
      "Recruitment, jobs, candidates, interviews, offers, and hiring analytics.",
    icon: "fa-users-rays",
    subdomain: "hire",
    featureKey: "recruitModule",
    status: "live",
  },
  {
    key: "core",
    productName: "Workcosmo Core",
    shortName: "CosmoCore",
    label: "Core",
    description:
      "Employee records, documents, HR operations, and lifecycle workflows.",
    icon: "fa-id-card-clip",
    subdomain: "core",
    featureKey: "coreModule",
    status: "live",
  },
  {
    key: "perform",
    productName: "Workcosmo Perform",
    shortName: "CosmoPerform",
    label: "Perform",
    description:
      "Goals, performance cycles, reviews, and manager feedback workflows.",
    icon: "fa-chart-line",
    subdomain: "perform",
    featureKey: "performModule",
    status: "live",
  },
  {
    key: "ai",
    productName: "Workcosmo AI",
    shortName: "CosmoAI",
    label: "AI",
    description:
      "AI-powered insights, resume parsing, interview preparation, and automation.",
    icon: "fa-brain",
    subdomain: "ai",
    featureKey: "aiModule",
    status: "live",
  },
]);

export function normalizeClientId(value = "") {
  return value
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

export function isModuleEnabled(company, moduleKey) {
  if (!company) return false;
  const modulesEnabled = company.modulesEnabled || {};
  if (Object.prototype.hasOwnProperty.call(modulesEnabled, moduleKey)) {
    return modulesEnabled[moduleKey] === true;
  }
  if (moduleKey === "hire") {
    const features = Array.isArray(company.features) ? company.features : [];
    return features.includes("recruitModule") || company.status === "active";
  }
  return false;
}

export function buildModuleUrl(moduleKey, companyId, ssoToken = "") {
  const mod = WORKCOSMO_MODULES.find((item) => item.key === moduleKey);
  const cid = encodeURIComponent(companyId || "");
  if (!mod || !cid) return "#";

  const host = window.location.hostname.toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
  
  let url = "";
  if (isLocal) {
    if (moduleKey === "hire") {
      url = `http://localhost:8091/app/index.html?companyId=${cid}`;
    } else if (moduleKey === "core") {
      url = `http://localhost:8093/index.html?companyId=${cid}`;
    } else if (moduleKey === "perform") {
      url = `http://localhost:8094/index.html?companyId=${cid}`;
    } else {
      return "#";
    }
  } else {
    url = `https://${mod.subdomain}.workcosmo.in/${cid}`;
  }

  if (ssoToken) {
    const separator = url.includes("?") ? "&" : "?";
    url += `${separator}ssoToken=${encodeURIComponent(ssoToken)}`;
  }
  return url;
}
