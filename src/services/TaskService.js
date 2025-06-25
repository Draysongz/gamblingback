import { supabase } from "../db/supabase.js";
import { logger } from "../utils/logger.js";

class TaskService {
  async getTasks(filters = {}, page = 1, limit = 10) {
    try {
      const start = (page - 1) * limit;
      const end = start + limit - 1;

      console.log("Fetching tasks with params:", {
        filters,
        page,
        limit,
        start,
        end,
      });

      let query = supabase
        .from("tasks")
        .select(
          `
          *,
          created_by:admins(id, username, email),
          user_completions:user_task_completions(
            id,
            user_id,
            status,
            completed_at,
            metrics
          )
        `,
          { count: "exact" }
        )
        .order("created_at", { ascending: false });

      // Apply filters
      if (filters.status) {
        query = query.eq("status", filters.status);
      }
      if (filters.created_by) {
        query = query.eq("created_by", filters.created_by);
      }

      const { data: tasks, error, count } = await query.range(start, end);

      console.log("Query result:", { tasks, error, count });

      if (error) {
        logger.error("Error in getTasks query:", error);
        throw error;
      }

      // Let's also check if there are any tasks at all
      const { count: totalTasks, error: countError } = await supabase
        .from("tasks")
        .select("*", { count: "exact", head: true });

      console.log("Total tasks in database:", { totalTasks, countError });

      return {
        tasks,
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      };
    } catch (error) {
      logger.error(`Error getting tasks: ${error.message}`);
      throw error;
    }
  }

  async getUserTaskCompletion(taskId, userId) {
    try {
      const { data: completion, error } = await supabase
        .from("user_task_completions")
        .select("*")
        .eq("task_id", taskId)
        .eq("user_id", userId)
        .single();

      if (error && error.code !== "PGRST116") throw error; // PGRST116 is "no rows returned"

      return completion;
    } catch (error) {
      logger.error(`Error getting user task completion: ${error.message}`);
      throw error;
    }
  }

  async updateUserTaskCompletion(taskId, userId, status, metrics = null) {
    try {
      // First check if the task exists and get its details
      const { data: task, error: taskError } = await supabase
        .from("tasks")
        .select("id, reward_amount, reward_type")
        .eq("id", taskId)
        .single();

      if (taskError) throw new Error("Task not found");

      // Then check if the user exists
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("id", userId)
        .single();

      if (userError) throw new Error("User not found");

      // Get or create user task completion
      let { data: completion, error: completionError } = await supabase
        .from("user_task_completions")
        .select("*")
        .eq("task_id", taskId)
        .eq("user_id", userId)
        .single();

      let wasCompleted = false;
      let wasAlreadyCompleted = false;

      if (completionError && completionError.code === "PGRST116") {
        // Create new completion if it doesn't exist
        const { data: newCompletion, error: createError } = await supabase
          .from("user_task_completions")
          .insert([
            {
              task_id: taskId,
              user_id: userId,
              status: status,
              metrics: metrics,
            },
          ])
          .select()
          .single();

        if (createError) throw createError;
        completion = newCompletion;
        wasCompleted = status === "completed";
      } else if (completionError) {
        throw completionError;
      } else {
        // Check if task was already completed
        wasAlreadyCompleted = completion.status === "completed";

        // Update existing completion
        const { data: updatedCompletion, error: updateError } = await supabase
          .from("user_task_completions")
          .update({
            status: status,
            metrics: metrics,
            completed_at:
              status === "completed"
                ? new Date().toISOString()
                : completion.completed_at,
            updated_at: new Date().toISOString(),
          })
          .eq("id", completion.id)
          .select()
          .single();

        if (updateError) throw updateError;
        completion = updatedCompletion;
        wasCompleted = status === "completed" && !wasAlreadyCompleted;
      }

      // Add rewards if task was just completed and wasn't already completed
      if (wasCompleted && task.reward_amount > 0) {
        try {
          // Calculate reward deltas based on reward type
          let brokecoinDelta = 0;
          let chipsDelta = 0;

          if (task.reward_type === "brokecoin") {
            brokecoinDelta = task.reward_amount;
          } else if (task.reward_type === "chips") {
            chipsDelta = task.reward_amount;
          }

          // Update user balance using the function from init.sql
          const { data: updatedUser, error: balanceError } = await supabase.rpc(
            "update_user_balance",
            {
              p_user_id: userId,
              p_brokecoin_delta: brokecoinDelta,
              p_chips_delta: chipsDelta,
            }
          );

          if (balanceError) {
            logger.error(
              `Error updating user balance: ${balanceError.message}`
            );
            throw new Error("Failed to add reward to user balance");
          }

          console.log(
            `Reward added to user ${userId}: ${task.reward_amount} ${task.reward_type}`
          );
        } catch (rewardError) {
          logger.error(`Error adding reward: ${rewardError.message}`);
          // Don't throw here - we still want to return the completion status
          // but log the error for debugging
        }
      }

      return completion;
    } catch (error) {
      logger.error(`Error updating user task completion: ${error.message}`);
      throw error;
    }
  }

  async getUserTasks(userId, filters = {}, page = 1, limit = 10) {
    try {
      const start = (page - 1) * limit;
      const end = start + limit - 1;

      let query = supabase
        .from("tasks")
        .select(
          `
          *,
          created_by:admins(id, username, email),
          user_completion:user_task_completions(
            id,
            status,
            completed_at,
            metrics
          )
        `,
          { count: "exact" }
        )
        .order("created_at", { ascending: false });

      const { data: tasks, error, count } = await query.range(start, end);

      if (error) throw error;

      // Filter tasks based on user completion status on the application side
      let filteredTasks = tasks;
      if (filters.status) {
        filteredTasks = tasks.filter((task) => {
          const userCompletion = task.user_completion?.find(
            (comp) => comp.user_id === userId
          );
          if (filters.status === "pending") {
            return !userCompletion || userCompletion.status === "pending";
          }
          return userCompletion && userCompletion.status === filters.status;
        });
      }

      return {
        tasks: filteredTasks,
        total: filteredTasks.length,
        page,
        limit,
        totalPages: Math.ceil(filteredTasks.length / limit),
      };
    } catch (error) {
      logger.error(`Error getting user tasks: ${error.message}`);
      throw error;
    }
  }

  async getTaskDetails(taskId, userId) {
    try {
      // Get task
      const { data: task, error: taskError } = await supabase
        .from("tasks")
        .select("*")
        .eq("id", taskId)
        .single();

      if (taskError) throw taskError;
      if (!task) throw new Error("Task not found");

      // Get user task completion (optional)
      const { data: completion, error: completionError } = await supabase
        .from("user_task_completions")
        .select("*")
        .eq("task_id", taskId)
        .eq("user_id", userId)
        .single(); // safer + cleaner

      if (completionError) throw completionError;

      return {
        ...task,
        user_completion: completion || null,
      };
    } catch (error) {
      logger.error(`Error fetching task details: ${error.message}`);
      throw error;
    }
  }
}

export default new TaskService();
