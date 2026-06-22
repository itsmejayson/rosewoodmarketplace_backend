// In-memory system settings.
// Boolean toggles reset on restart intentionally (e.g. aiAssistantEnabled).
// String branding keys (appName, appTagline) are loaded from DB on startup via settingsService.
const settings = {
  aiAssistantEnabled: false,
  appName: 'Rosewood',
  appTagline: 'Fresh food & quality materials',
  brandColor: '#C84B6E',
  logoUrl: null,
  logoPublicId: null,
};

module.exports = settings;
