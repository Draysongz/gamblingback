import express from "express";
import adminAuthService from "../services/AdminAuthService.js";
import { validateAdminAccess } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";
import { ERROR_MESSAGES } from "../utils/constants.js";

const router = express.Router();

// Create first super admin (no auth required, but only works if no super admin exists)
router.post("/setup", async (req, res) => {
  try {
    const adminData = req.body;
    const newAdmin = await adminAuthService.createFirstSuperAdmin(adminData);
    res.status(201).json(newAdmin);
  } catch (error) {
    logger.error(`Error in POST /admin/auth/setup: ${error.message}`);
    if (error.message === ERROR_MESSAGES.SUPER_ADMIN_EXISTS) {
      res.status(403).json({ error: error.message });
    } else if (error.message === ERROR_MESSAGES.ADMIN_ALREADY_EXISTS) {
      res.status(409).json({ error: error.message });
    } else if (error.message === ERROR_MESSAGES.INVALID_INPUT) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Admin registration (only super_admin can create new admins)
router.post("/register", validateAdminAccess, async (req, res) => {
  try {
    const adminData = req.body;
    const newAdmin = await adminAuthService.register(adminData, req.admin.id);
    res.status(201).json(newAdmin);
  } catch (error) {
    logger.error(`Error in POST /admin/auth/register: ${error.message}`);
    if (error.message === ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS) {
      res.status(403).json({ error: error.message });
    } else if (error.message === ERROR_MESSAGES.ADMIN_ALREADY_EXISTS) {
      res.status(409).json({ error: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Admin login
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await adminAuthService.login(username, password);
    res.json(result);
  } catch (error) {
    logger.error(`Error in POST /admin/auth/login: ${error.message}`);
    res.status(401).json({ error: error.message });
  }
});

// Get admin profile
router.get("/profile", validateAdminAccess, async (req, res) => {
  try {
    const profile = await adminAuthService.getProfile(req.admin.id);
    res.json(profile);
  } catch (error) {
    logger.error(`Error in GET /admin/auth/profile: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;
