import { supabase } from "../db/supabase.js";
import { logger } from "../utils/logger.js";
import { TRANSACTION_STATUS, ERROR_MESSAGES } from "../utils/constants.js";

class AdminService {
  // Verify admin access
  async verifyAdminAccess(adminId) {
    try {
      const { data: admin, error } = await supabase
        .from("admins")
        .select("id, role")
        .eq("id", adminId)
        .single();

      if (error) throw error;
      if (!admin) throw new Error(ERROR_MESSAGES.ADMIN_NOT_FOUND);

      return admin;
    } catch (error) {
      logger.error(`Error verifying admin access: ${error.message}`);
      throw error;
    }
  }

  // Get all users with pagination
  async getAllUsers(page = 1, limit = 10, filters = {}) {
    try {
      const start = (page - 1) * limit;
      const end = start + limit - 1;

      let query = supabase
        .from("users")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false });

      // Apply role filter
      if (filters.role) {
        query = query.eq("role", filters.role);
      }

      const { data: users, error, count } = await query.range(start, end);

      if (error) throw error;

      return {
        users,
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      };
    } catch (error) {
      logger.error(`Error getting users: ${error.message}`);
      throw error;
    }
  }

  // Get all admins with pagination
  async getAdmins(page = 1, limit = 10, filters = {}) {
    try {
      const start = (page - 1) * limit;
      const end = start + limit - 1;

      let query = supabase
        .from("admins")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false });

      // Apply role filter
      if (filters.role) {
        query = query.eq("role", filters.role);
      }

      const { data: admins, error, count } = await query.range(start, end);

      if (error) throw error;

      return {
        users: admins,
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      };
    } catch (error) {
      logger.error(`Error getting admins: ${error.message}`);
      throw error;
    }
  }

  // Get user details by ID
  async getUserDetails(userId) {
    try {
      const { data: user, error } = await supabase
        .from("users")
        .select(
          `
          *,
          transactions (
            id,
            type,
            amount,
            currency,
            status,
            created_at
          )
        `
        )
        .eq("id", userId)
        .single();

      if (error) throw error;
      if (!user) throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);

      return user;
    } catch (error) {
      logger.error(`Error getting user details: ${error.message}`);
      throw error;
    }
  }

  // Update user balance (admin override)
  async updateUserBalance(userId, brokecoinDelta, chipsDelta, adminId) {
    try {
      // Verify admin access
      await this.verifyAdminAccess(adminId);

      // Update user balance
      const { data: user, error } = await supabase.rpc("update_user_balance", {
        p_user_id: userId,
        p_brokecoin_delta: brokecoinDelta,
        p_chips_delta: chipsDelta,
      });

      if (error) throw error;

      // Log the admin action
      await supabase.from("admin_actions").insert([
        {
          admin_id: adminId,
          action_type: "UPDATE_USER_BALANCE",
          target_user_id: userId,
          metadata: {
            brokecoinDelta,
            chipsDelta,
            newBalance: user,
          },
        },
      ]);

      return user;
    } catch (error) {
      logger.error(`Error updating user balance: ${error.message}`);
      throw error;
    }
  }

  // Get all transactions with filters
  async getAllTransactions(filters = {}, page = 1, limit = 10) {
    try {
      const start = (page - 1) * limit;
      const end = start + limit - 1;

      let query = supabase
        .from("transactions")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false });

      // Apply filters
      if (filters.status) {
        query = query.eq("status", filters.status);
      }
      if (filters.type) {
        query = query.eq("type", filters.type);
      }
      if (filters.wallet_address) {
        query = query.eq("wallet_address", filters.wallet_address);
      }
      if (filters.start_date) {
        query = query.gte("created_at", filters.start_date);
      }
      if (filters.end_date) {
        query = query.lte("created_at", filters.end_date);
      }

      const {
        data: transactions,
        error,
        count,
      } = await query.range(start, end);

      if (error) throw error;

      return {
        transactions,
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      };
    } catch (error) {
      logger.error(`Error getting transactions: ${error.message}`);
      throw error;
    }
  }

  // Update transaction status (admin override)
  async updateTransactionStatus(transactionId, status, adminId) {
    try {
      // Verify admin access
      await this.verifyAdminAccess(adminId);

      // Update transaction status
      const { data: transaction, error } = await supabase
        .from("transactions")
        .update({ status })
        .eq("id", transactionId)
        .select()
        .single();

      if (error) throw error;
      if (!transaction) throw new Error(ERROR_MESSAGES.TRANSACTION_NOT_FOUND);

      // Log the admin action
      await supabase.from("admin_actions").insert([
        {
          admin_id: adminId,
          action_type: "UPDATE_TRANSACTION_STATUS",
          target_transaction_id: transactionId,
          metadata: {
            oldStatus: transaction.status,
            newStatus: status,
          },
        },
      ]);

      return transaction;
    } catch (error) {
      logger.error(`Error updating transaction status: ${error.message}`);
      throw error;
    }
  }

  // Get system statistics
  async getSystemStats() {
    try {
      const [
        { count: totalUsers },
        { count: totalTransactions },
        { count: pendingTransactions },
        { data: totalBalances },
      ] = await Promise.all([
        supabase.from("users").select("*", { count: "exact", head: true }),
        supabase
          .from("transactions")
          .select("*", { count: "exact", head: true }),
        supabase
          .from("transactions")
          .select("*", { count: "exact", head: true })
          .eq("status", TRANSACTION_STATUS.PENDING),
        supabase.rpc("get_total_balances"),
      ]);

      return {
        totalUsers,
        totalTransactions,
        pendingTransactions,
        totalBalances: totalBalances[0] || { brokecoin: 0, chips: 0 },
      };
    } catch (error) {
      logger.error(`Error getting system stats: ${error.message}`);
      throw error;
    }
  }

  // Task Management Methods
  async createTask(taskData, adminId) {
    try {
      await this.verifyAdminAccess(adminId);

      const { data: task, error } = await supabase
        .from("tasks")
        .insert([
          {
            ...taskData,
            created_by: adminId,
            status: "pending",
          },
        ])
        .select()
        .single();

      if (error) throw error;

      // Log the admin action
      await supabase.from("admin_actions").insert([
        {
          admin_id: adminId,
          action_type: "CREATE_TASK",
          metadata: {
            task_id: task.id,
            user_id: taskData.user_id,
            task_data: taskData,
          },
        },
      ]);

      return task;
    } catch (error) {
      logger.error(`Error creating task: ${error.message}`);
      throw error;
    }
  }

  async getTasks(filters = {}, page = 1, limit = 10) {
    try {
      const start = (page - 1) * limit;
      const end = start + limit - 1;

      let query = supabase
        .from("tasks")
        .select(
          `
          *,
          created_by:admins(id, username, email)
        `,
          { count: "exact" }
        )
        .order("created_at", { ascending: false });

      // Apply filters
      if (filters.status) {
        query = query.eq("status", filters.status);
      }
      if (filters.user_id) {
        query = query.eq("user_id", filters.user_id);
      }
      if (filters.created_by) {
        query = query.eq("created_by", filters.created_by);
      }

      const { data: tasks, error, count } = await query.range(start, end);

      if (error) throw error;

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

  async getTaskDetails(taskId) {
    try {
      const { data: task, error } = await supabase
        .from("tasks")
        .select(
          `
          *,
          user:users(id, username, wallet_address),
          created_by:admins(id, username, email),
          comments:task_comments(
            id,
            comment,
            created_at,
            admin:admins(id, username, email)
          ),
          attachments:task_attachments(
            id,
            file_name,
            file_url,
            file_type,
            file_size,
            created_at,
            admin:admins(id, username, email)
          )
        `
        )
        .eq("id", taskId)
        .single();

      if (error) throw error;
      if (!task) throw new Error(ERROR_MESSAGES.TASK_NOT_FOUND);

      return task;
    } catch (error) {
      logger.error(`Error getting task details: ${error.message}`);
      throw error;
    }
  }

  async deleteTask(taskId, adminId) {
    try {
      await this.verifyAdminAccess(adminId);

      const { error } = await supabase.rpc("delete_task", {
        p_task_id: taskId,
        p_admin_id: adminId,
      });

      if (error) throw error;
    } catch (error) {
      logger.error(`Error deleting task: ${error.message}`);
      throw error;
    }
  }

  async updateTaskStatus(taskId, status, adminId) {
    try {
      await this.verifyAdminAccess(adminId);

      const { data: task, error } = await supabase.rpc("update_task_status", {
        p_task_id: taskId,
        p_status: status,
        p_admin_id: adminId,
      });

      if (error) throw error;
      if (!task) throw new Error(ERROR_MESSAGES.TASK_NOT_FOUND);

      return task;
    } catch (error) {
      logger.error(`Error updating task status: ${error.message}`);
      throw error;
    }
  }

  async addTaskComment(taskId, comment, adminId) {
    try {
      await this.verifyAdminAccess(adminId);

      const { data: taskComment, error } = await supabase
        .from("task_comments")
        .insert([
          {
            task_id: taskId,
            admin_id: adminId,
            comment,
          },
        ])
        .select()
        .single();

      if (error) throw error;

      // Log the admin action
      await supabase.from("admin_actions").insert([
        {
          admin_id: adminId,
          action_type: "ADD_TASK_COMMENT",
          metadata: {
            task_id: taskId,
            comment_id: taskComment.id,
          },
        },
      ]);

      return taskComment;
    } catch (error) {
      logger.error(`Error adding task comment: ${error.message}`);
      throw error;
    }
  }

  async addTaskAttachment(taskId, fileData, adminId) {
    try {
      await this.verifyAdminAccess(adminId);

      const { data: attachment, error } = await supabase
        .from("task_attachments")
        .insert([
          {
            task_id: taskId,
            admin_id: adminId,
            ...fileData,
          },
        ])
        .select()
        .single();

      if (error) throw error;

      // Log the admin action
      await supabase.from("admin_actions").insert([
        {
          admin_id: adminId,
          action_type: "ADD_TASK_ATTACHMENT",
          metadata: {
            task_id: taskId,
            attachment_id: attachment.id,
            file_name: fileData.file_name,
          },
        },
      ]);

      return attachment;
    } catch (error) {
      logger.error(`Error adding task attachment: ${error.message}`);
      throw error;
    }
  }

  // Create new user
  async createUser(userData, adminId) {
    try {
      // Verify admin access
      await this.verifyAdminAccess(adminId);

      // Check if username already exists
      const { data: existingUser, error: checkError } = await supabase
        .from("users")
        .select("id")
        .eq("username", userData.username)
        .single();

      if (checkError && checkError.code !== "PGRST116") {
        throw checkError;
      }

      if (existingUser) {
        throw new Error(ERROR_MESSAGES.USERNAME_EXISTS);
      }

      // Check if wallet address already exists
      const { data: existingWallet, error: walletError } = await supabase
        .from("users")
        .select("id")
        .eq("wallet_address", userData.wallet_address)
        .single();

      if (walletError && walletError.code !== "PGRST116") {
        throw walletError;
      }

      if (existingWallet) {
        throw new Error(ERROR_MESSAGES.WALLET_EXISTS);
      }

      // Validate role
      const validRoles = ["user", "admin", "superadmin"];
      if (userData.role && !validRoles.includes(userData.role)) {
        throw new Error("Invalid role specified");
      }

      // Create user
      const { data: user, error } = await supabase
        .from("users")
        .insert([
          {
            username: userData.username,
            wallet_address: userData.wallet_address,
            chips_balance: userData.chips_balance || 0,
            brokecoin_balance: userData.brokecoin_balance || 0,
            role: userData.role || "user",
          },
        ])
        .select()
        .single();

      if (error) throw error;

      // Log the admin action
      await supabase.from("admin_actions").insert([
        {
          admin_id: adminId,
          action_type: "CREATE_USER",
          target_user_id: user.id,
          metadata: {
            username: userData.username,
            wallet_address: userData.wallet_address,
            role: userData.role || "user",
            chips_balance: userData.chips_balance || 0,
            brokecoin_balance: userData.brokecoin_balance || 0,
          },
        },
      ]);

      return user;
    } catch (error) {
      logger.error(`Error creating user: ${error.message}`);
      throw error;
    }
  }

  // Update user
  async updateUser(userId, userData, adminId) {
    try {
      // Verify admin access
      await this.verifyAdminAccess(adminId);

      // Check if user exists
      const { data: existingUser, error: userError } = await supabase
        .from("users")
        .select("id, username, wallet_address")
        .eq("id", userId)
        .single();

      if (userError || !existingUser) {
        throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
      }

      // Check username uniqueness if changed
      if (userData.username && userData.username !== existingUser.username) {
        const { data: usernameExists, error: checkError } = await supabase
          .from("users")
          .select("id")
          .eq("username", userData.username)
          .single();

        if (checkError && checkError.code !== "PGRST116") {
          throw checkError;
        }

        if (usernameExists) {
          throw new Error(ERROR_MESSAGES.USERNAME_EXISTS);
        }
      }

      // Check wallet address uniqueness if changed
      if (
        userData.wallet_address &&
        userData.wallet_address !== existingUser.wallet_address
      ) {
        const { data: walletExists, error: walletError } = await supabase
          .from("users")
          .select("id")
          .eq("wallet_address", userData.wallet_address)
          .single();

        if (walletError && walletError.code !== "PGRST116") {
          throw walletError;
        }

        if (walletExists) {
          throw new Error(ERROR_MESSAGES.WALLET_EXISTS);
        }
      }

      // Validate role if changed
      if (userData.role) {
        const validRoles = ["user", "admin", "superadmin"];
        if (!validRoles.includes(userData.role)) {
          throw new Error("Invalid role specified");
        }
      }

      // Update user
      const { data: user, error } = await supabase
        .from("users")
        .update({
          username: userData.username,
          wallet_address: userData.wallet_address,
          chips_balance: userData.chips_balance,
          brokecoin_balance: userData.brokecoin_balance,
          role: userData.role,
        })
        .eq("id", userId)
        .select()
        .single();

      if (error) throw error;

      // Log the admin action
      await supabase.from("admin_actions").insert([
        {
          admin_id: adminId,
          action_type: "UPDATE_USER",
          target_user_id: userId,
          metadata: {
            old_data: existingUser,
            new_data: userData,
          },
        },
      ]);

      return user;
    } catch (error) {
      logger.error(`Error updating user: ${error.message}`);
      throw error;
    }
  }

  // Delete user
  async deleteUser(userId, adminId) {
    try {
      // Verify admin access
      await this.verifyAdminAccess(adminId);

      // Check if user exists
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (userError || !user) {
        throw new Error(ERROR_MESSAGES.USER_NOT_FOUND);
      }

      // Delete user
      const { error } = await supabase.from("users").delete().eq("id", userId);

      if (error) throw error;

      // Log the admin action
      await supabase.from("admin_actions").insert([
        {
          admin_id: adminId,
          action_type: "DELETE_USER",
          target_user_id: userId,
          metadata: {
            deleted_user: user,
          },
        },
      ]);

      return { success: true };
    } catch (error) {
      logger.error(`Error deleting user: ${error.message}`);
      throw error;
    }
  }
}

export default new AdminService();
