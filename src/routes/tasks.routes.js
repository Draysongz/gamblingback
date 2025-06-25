import express from "express";
import TaskService from "../services/TaskService.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

// Get all tasks available to the user
router.get("/", authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const tasks = await TaskService.getTasks(
      { status },
      parseInt(page),
      parseInt(limit)
    );
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get user's tasks with completion status - MUST be before /:taskId route
router.get("/my-tasks", authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const tasks = await TaskService.getUserTasks(
      req.user.id,
      { status },
      parseInt(page),
      parseInt(limit)
    );
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get task details with user's completion status
router.get("/:taskId", authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await TaskService.getTaskDetails(taskId, req.user.id);
    const completion = await TaskService.getUserTaskCompletion(
      taskId,
      req.user.id
    );
    res.json({ ...task, user_completion: completion });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update user's task completion status
router.patch("/:taskId/completion", authenticate, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status, metrics } = req.body;
    const completion = await TaskService.updateUserTaskCompletion(
      taskId,
      req.user.id,
      status,
      metrics
    );
    res.json(completion);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
