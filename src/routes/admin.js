import express from "express";
import adminService from "../services/AdminService.js";
import { validateAdminAccess } from "../middleware/auth.js";
import { logger } from "../utils/logger.js";

const router = express.Router();

// Apply admin access middleware to all routes
router.use(validateAdminAccess);

// User Management
router.get("/users", async (req, res) => {
  try {
    const { page, limit, role } = req.query;
    const result = await adminService.getAllUsers(
      parseInt(page) || 1,
      parseInt(limit) || 10,
      { role }
    );
    res.json(result);
  } catch (error) {
    logger.error(`Error in GET /admin/users: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.post("/users", async (req, res) => {
  try {
    const user = await adminService.createUser(req.body, req.admin.id);
    res.status(201).json(user);
  } catch (error) {
    logger.error(`Error in POST /admin/users: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.put("/users/:userId", async (req, res) => {
  try {
    const user = await adminService.updateUser(
      req.params.userId,
      req.body,
      req.admin.id
    );
    res.json(user);
  } catch (error) {
    logger.error(`Error in PUT /admin/users/:userId: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/users/:userId", async (req, res) => {
  try {
    await adminService.deleteUser(req.params.userId, req.admin.id);
    res.status(204).send();
  } catch (error) {
    logger.error(`Error in DELETE /admin/users/:userId: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.get("/admins", async (req, res) => {
  try {
    const { page, limit, role } = req.query;
    const result = await adminService.getAdmins(
      parseInt(page) || 1,
      parseInt(limit) || 10,
      { role }
    );
    res.json(result);
  } catch (error) {
    logger.error(`Error in GET /admin/admins: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.get("/users/:userId", async (req, res) => {
  try {
    const user = await adminService.getUserDetails(req.params.userId);
    res.json(user);
  } catch (error) {
    logger.error(`Error in GET /admin/users/:userId: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.post("/users/:userId/balance", async (req, res) => {
  try {
    const { brokecoinDelta, chipsDelta } = req.body;
    const result = await adminService.updateUserBalance(
      req.params.userId,
      brokecoinDelta,
      chipsDelta,
      req.admin.id
    );
    res.json(result);
  } catch (error) {
    logger.error(
      `Error in POST /admin/users/:userId/balance: ${error.message}`
    );
    res.status(500).json({ error: error.message });
  }
});

// Transaction Management
router.get("/transactions", async (req, res) => {
  try {
    const { page, limit, ...filters } = req.query;
    const result = await adminService.getAllTransactions(
      filters,
      parseInt(page) || 1,
      parseInt(limit) || 10
    );
    res.json(result);
  } catch (error) {
    logger.error(`Error in GET /admin/transactions: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.patch("/transactions/:transactionId/status", async (req, res) => {
  try {
    const { status } = req.body;
    const result = await adminService.updateTransactionStatus(
      req.params.transactionId,
      status,
      req.admin.id
    );
    res.json(result);
  } catch (error) {
    logger.error(
      `Error in PATCH /admin/transactions/:transactionId/status: ${error.message}`
    );
    res.status(500).json({ error: error.message });
  }
});

// Task Management
router.post("/tasks", async (req, res) => {
  try {
    const task = await adminService.createTask(req.body, req.admin.id);
    res.status(201).json(task);
  } catch (error) {
    logger.error(`Error in POST /admin/tasks: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.get("/tasks", async (req, res) => {
  try {
    const { page, limit, ...filters } = req.query;
    const result = await adminService.getTasks(
      filters,
      parseInt(page) || 1,
      parseInt(limit) || 10
    );
    res.json(result);
  } catch (error) {
    logger.error(`Error in GET /admin/tasks: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.get("/tasks/:taskId", async (req, res) => {
  try {
    const task = await adminService.getTaskDetails(req.params.taskId);
    res.json(task);
  } catch (error) {
    logger.error(`Error in GET /admin/tasks/:taskId: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/tasks/:taskId", async (req, res) => {
  try {
    await adminService.deleteTask(req.params.taskId, req.admin.id);
    res.status(204).send();
  } catch (error) {
    logger.error(`Error in DELETE /admin/tasks/:taskId: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

router.patch("/tasks/:taskId/status", async (req, res) => {
  try {
    const { status } = req.body;
    const task = await adminService.updateTaskStatus(
      req.params.taskId,
      status,
      req.admin.id
    );
    res.json(task);
  } catch (error) {
    logger.error(
      `Error in PATCH /admin/tasks/:taskId/status: ${error.message}`
    );
    res.status(500).json({ error: error.message });
  }
});

router.post("/tasks/:taskId/comments", async (req, res) => {
  try {
    const { comment } = req.body;
    const taskComment = await adminService.addTaskComment(
      req.params.taskId,
      comment,
      req.admin.id
    );
    res.status(201).json(taskComment);
  } catch (error) {
    logger.error(
      `Error in POST /admin/tasks/:taskId/comments: ${error.message}`
    );
    res.status(500).json({ error: error.message });
  }
});

router.post("/tasks/:taskId/attachments", async (req, res) => {
  try {
    const attachment = await adminService.addTaskAttachment(
      req.params.taskId,
      req.body,
      req.admin.id
    );
    res.status(201).json(attachment);
  } catch (error) {
    logger.error(
      `Error in POST /admin/tasks/:taskId/attachments: ${error.message}`
    );
    res.status(500).json({ error: error.message });
  }
});

// System Statistics
router.get("/stats", async (req, res) => {
  try {
    const stats = await adminService.getSystemStats();
    res.json(stats);
  } catch (error) {
    logger.error(`Error in GET /admin/stats: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

export default router;
