/**
 * Map user-{id} Chrome profile ↔ CCCD (từ info.txt).
 * user_id 1 = Ý, 2 = Luyến, 3 = Nhung, 4 = Huy
 */
(function () {
  const DEFAULT_PASSWORD = "123456";

  const PROFILE_MAP = {
    1: { name: "Ý", cccd: "067199004010" },
    2: { name: "Luyến", cccd: "067188003393" },
    3: { name: "Nhung", cccd: "067182000262" },
    4: { name: "Huy", cccd: "067090002078" },
    5:{name:"Thắng", cccd: "038081015728"}
  };

  function getProfile(userId) {
    const id = Number(userId);
    return PROFILE_MAP[id] || null;
  }

  function getCccd(userId) {
    return getProfile(userId)?.cccd || null;
  }

  function getDefaultPassword() {
    return DEFAULT_PASSWORD;
  }

  function listProfiles() {
    return Object.entries(PROFILE_MAP).map(([id, p]) => ({
      user_id: Number(id),
      ...p,
    }));
  }

  window.NCN_PROFILE_MAP = {
    PROFILE_MAP,
    getProfile,
    getCccd,
    getDefaultPassword,
    listProfiles,
  };
})();
