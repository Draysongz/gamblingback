import { expect } from "chai";
import adminService from "../services/AdminService.js";
import { supabase } from "../db/supabase.js";
import { TRANSACTION_STATUS } from "../utils/constants.js";
import { logger } from "../utils/logger.js";

describe("AdminService", () => {
  let testAdmin;
  let testUser;
  let testTransaction;

  before(async () => {
    // Create test admin
    const { data: admin, error: adminError } = await supabase
      .from("admins")
      .insert([
        {
          username: "test_admin",
          email: "test@admin.com",
          role: "admin",
        },
      ])
      .select()
      .single();

    if (adminError) throw adminError;
    testAdmin = admin;

    // Create test user
    const { data: user, error: userError } = await supabase
      .from("users")
      .insert([
        {
          username: "test_user",
          wallet_address: "test_wallet_address",
          brokecoin_balance: 1000,
          chips_balance: 0,
        },
      ])
      .select()
      .single();

    if (userError) throw userError;
    testUser = user;

    // Create test transaction
    const { data: transaction, error: txError } = await supabase
      .from("transactions")
      .insert([
        {
          type: "PURCHASE_CHIPS",
          user_id: testUser.id,
          amount: 1,
          currency: "BROKECOIN",
          status: TRANSACTION_STATUS.PENDING,
          wallet_address: testUser.wallet_address,
        },
      ])
      .select()
      .single();

    if (txError) throw txError;
    testTransaction = transaction;
  });

  after(async () => {
    // Clean up test data
    await supabase.from("admin_actions").delete().eq("admin_id", testAdmin.id);
    await supabase.from("transactions").delete().eq("id", testTransaction.id);
    await supabase.from("users").delete().eq("id", testUser.id);
    await supabase.from("admins").delete().eq("id", testAdmin.id);
  });

  describe("getAllUsers", () => {
    it("should get all users with pagination", async () => {
      const result = await adminService.getAllUsers(1, 10);
      expect(result).to.have.property("users");
      expect(result).to.have.property("total");
      expect(result).to.have.property("page");
      expect(result).to.have.property("limit");
      expect(result).to.have.property("totalPages");
    });
  });

  describe("getUserDetails", () => {
    it("should get user details with transactions", async () => {
      const user = await adminService.getUserDetails(testUser.id);
      expect(user).to.have.property("id", testUser.id);
      expect(user).to.have.property("transactions");
      expect(user.transactions).to.be.an("array");
    });
  });

  describe("updateUserBalance", () => {
    it("should update user balance and log admin action", async () => {
      const result = await adminService.updateUserBalance(
        testUser.id,
        -1,
        100,
        testAdmin.id
      );

      expect(result).to.have.property("brokecoin_balance", 999);
      expect(result).to.have.property("chips_balance", 100);

      // Verify admin action was logged
      const { data: actions, error } = await supabase
        .from("admin_actions")
        .select("*")
        .eq("admin_id", testAdmin.id)
        .eq("action_type", "UPDATE_USER_BALANCE")
        .single();

      expect(error).to.be.null;
      expect(actions).to.have.property("target_user_id", testUser.id);
    });
  });

  describe("getAllTransactions", () => {
    it("should get all transactions with filters", async () => {
      const result = await adminService.getAllTransactions(
        { status: TRANSACTION_STATUS.PENDING },
        1,
        10
      );

      expect(result).to.have.property("transactions");
      expect(result).to.have.property("total");
      expect(result.transactions).to.be.an("array");
    });
  });

  describe("updateTransactionStatus", () => {
    it("should update transaction status and log admin action", async () => {
      const result = await adminService.updateTransactionStatus(
        testTransaction.id,
        TRANSACTION_STATUS.COMPLETED,
        testAdmin.id
      );

      expect(result).to.have.property("status", TRANSACTION_STATUS.COMPLETED);

      // Verify admin action was logged
      const { data: actions, error } = await supabase
        .from("admin_actions")
        .select("*")
        .eq("admin_id", testAdmin.id)
        .eq("action_type", "UPDATE_TRANSACTION_STATUS")
        .single();

      expect(error).to.be.null;
      expect(actions).to.have.property(
        "target_transaction_id",
        testTransaction.id
      );
    });
  });

  describe("getSystemStats", () => {
    it("should get system statistics", async () => {
      const stats = await adminService.getSystemStats();
      expect(stats).to.have.property("totalUsers");
      expect(stats).to.have.property("totalTransactions");
      expect(stats).to.have.property("pendingTransactions");
      expect(stats).to.have.property("totalBalances");
    });
  });
});
