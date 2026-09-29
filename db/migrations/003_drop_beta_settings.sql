-- beta_settings was replaced by the server-side beta configuration module
-- (BETA_OPEN of each contour, bot/beta-config.js). Applied migrations are
-- immutable: 002 stays as is, this file only drops the obsolete table.
-- Deploy only after the bot without beta_settings access runs in the contour.
DROP TABLE beta_settings;
