import jwt from "jsonwebtoken";
import { supabase } from "../db/supabase.js";
import { logger } from "../utils/logger.js";
import { ERROR_MESSAGES, ADMIN_ROLES } from "../utils/constants.js";
import config from "../config/config.js";
import bcrypt from "bcryptjs";

class AdminAuthService {
  async hasSuperAdmin() {
    try {
      const { count, error } = await supabase
        .from("admins")
        .select("*", { count: "exact", head: true })
        .eq("role", ADMIN_ROLES.SUPER_ADMIN);

      if (error) throw error;
      return count > 0;
    } catch (error) {
      logger.error(`Error checking super admin existence: ${error.message}`);
      throw error;
    }
  }

  async createFirstSuperAdmin(adminData) {
    try {
      // Check if any super admin exists
      const hasSuperAdmin = await this.hasSuperAdmin();
      if (hasSuperAdmin) {
        throw new Error(ERROR_MESSAGES.SUPER_ADMIN_EXISTS);
      }

      // Validate required fields
      if (!adminData.username || !adminData.email || !adminData.password) {
        throw new Error(ERROR_MESSAGES.INVALID_INPUT);
      }

      // Check if username or email already exists
      const { data: existingAdmin, error: checkError } = await supabase
        .from("admins")
        .select("id")
        .or(`username.eq.${adminData.username},email.eq.${adminData.email}`)
        .single();

      if (existingAdmin) {
        throw new Error(ERROR_MESSAGES.ADMIN_ALREADY_EXISTS);
      }

      const hashedPassword = await bcrypt.hash(adminData.password, 10);

      // Create super admin
      const { data: newAdmin, error: createError } = await supabase
        .from("admins")
        .insert([
          {
            username: adminData.username,
            email: adminData.email,
            password_hash: hashedPassword,
            role: ADMIN_ROLES.SUPER_ADMIN,
          },
        ])
        .select()
        .single();

      if (createError) throw createError;

      // Log the super admin creation
      await supabase.from("admin_actions").insert([
        {
          admin_id: newAdmin.id,
          action_type: "CREATE_FIRST_SUPER_ADMIN",
          metadata: {
            admin_id: newAdmin.id,
          },
        },
      ]);

      // Remove sensitive data
      delete newAdmin.password_hash;

      return newAdmin;
    } catch (error) {
      logger.error(`Error creating first super admin: ${error.message}`);
      throw error;
    }
  }

  async register(adminData, createdByAdminId) {
    try {
      // Verify creating admin has super_admin role
      const { data: creatingAdmin, error: adminError } = await supabase
        .from("admins")
        .select("role")
        .eq("id", createdByAdminId)
        .single();

      if (adminError || !creatingAdmin) {
        throw new Error(ERROR_MESSAGES.ADMIN_NOT_FOUND);
      }

      if (creatingAdmin.role !== ADMIN_ROLES.SUPER_ADMIN) {
        throw new Error(ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS);
      }

      // Check if username or email already exists
      const { data: existingAdmin, error: checkError } = await supabase
        .from("admins")
        .select("id")
        .or(`username.eq.${adminData.username},email.eq.${adminData.email}`)
        .single();

      if (existingAdmin) {
        throw new Error(ERROR_MESSAGES.ADMIN_ALREADY_EXISTS);
      }

      const hashedPassword = await bcrypt.hash(adminData.password, 10);
      // Create new admin
      const { data: newAdmin, error: createError } = await supabase
        .from("admins")
        .insert([
          {
            username: adminData.username,
            email: adminData.email,
            password_hash: hashedPassword,
            role: adminData.role || ADMIN_ROLES.ADMIN,
          },
        ])
        .select()
        .single();

      if (createError) throw createError;

      // Log the admin creation
      await supabase.from("admin_actions").insert([
        {
          admin_id: createdByAdminId,
          action_type: "CREATE_ADMIN",
          metadata: {
            new_admin_id: newAdmin.id,
            new_admin_role: newAdmin.role,
          },
        },
      ]);

      // Remove sensitive data
      delete newAdmin.password_hash;

      return newAdmin;
    } catch (error) {
      logger.error(`Error in admin registration: ${error.message}`);
      throw error;
    }
  }

  async login(username, password) {
    try {
      // Get admin from database
      const { data: admin, error } = await supabase
        .from("admins")
        .select("id, username, email, role, password_hash")
        .eq("username", username)
        .single();

      if (error || !admin) {
        throw new Error(ERROR_MESSAGES.ADMIN_NOT_FOUND);
      }

      // Verify password using bcrypt
      const isPasswordValid = await bcrypt.compare(
        password,
        admin.password_hash
      );
      if (!isPasswordValid) {
        throw new Error(ERROR_MESSAGES.INVALID_CREDENTIALS);
      }

      // Update last login
      await supabase.rpc("update_admin_last_login", {
        p_admin_id: admin.id,
      });

      // Generate JWT token
      const token = jwt.sign(
        { id: admin.id, role: admin.role },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );

      // Remove sensitive data
      delete admin.password_hash;

      return {
        admin,
        token,
      };
    } catch (error) {
      logger.error(`Error in admin login: ${error.message}`);
      throw error;
    }
  }

  async getProfile(adminId) {
    try {
      const { data: admin, error } = await supabase
        .from("admins")
        .select("id, username, email, role, last_login")
        .eq("id", adminId)
        .single();

      if (error || !admin) {
        throw new Error(ERROR_MESSAGES.ADMIN_NOT_FOUND);
      }

      return admin;
    } catch (error) {
      logger.error(`Error getting admin profile: ${error.message}`);
      throw error;
    }
  }
}

export default new AdminAuthService();
