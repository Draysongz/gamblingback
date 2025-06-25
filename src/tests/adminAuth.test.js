import request from "supertest";
import app from "../app.js";
import { supabase } from "../db/supabase.js";
import { ADMIN_ROLES } from "../utils/constants.js";
import { before } from "mocha";
import { expect } from "chai";

describe("Admin Authentication", () => {
  let superAdminToken;
  let superAdminId;

  // Clean up database before tests
  before(async () => {
    // Delete all existing admins
    await supabase
      .from("admin_actions")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase
      .from("admins")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
  });

  describe("POST /admin/auth/setup", () => {
    it("should create first super admin", async () => {
      const response = await request(app).post("/admin/auth/setup").send({
        username: "superadmin",
        email: "superadmin@example.com",
        password: "securepassword123",
      });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("id");
      expect(response.body.role).toBe(ADMIN_ROLES.SUPER_ADMIN);
      expect(response.body).not.toHaveProperty("password_hash");
    });

    it("should not allow creating second super admin", async () => {
      const response = await request(app).post("/admin/auth/setup").send({
        username: "anothersuper",
        email: "anothersuper@example.com",
        password: "securepassword123",
      });

      expect(response.status).toBe(403);
    });
  });

  describe("POST /admin/auth/login", () => {
    it("should login super admin", async () => {
      const response = await request(app).post("/admin/auth/login").send({
        username: "superadmin",
        password: "securepassword123",
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("token");
      expect(response.body).toHaveProperty("admin");
      expect(response.body.admin.role).toBe(ADMIN_ROLES.SUPER_ADMIN);

      superAdminToken = response.body.token;
      superAdminId = response.body.admin.id;
    });

    it("should not login with wrong password", async () => {
      const response = await request(app).post("/admin/auth/login").send({
        username: "superadmin",
        password: "wrongpassword",
      });

      expect(response.status).toBe(401);
    });
  });

  describe("POST /admin/auth/register", () => {
    it("should create new admin by super admin", async () => {
      const response = await request(app)
        .post("/admin/auth/register")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          username: "newadmin",
          email: "newadmin@example.com",
          password: "adminpass123",
          role: ADMIN_ROLES.ADMIN,
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("id");
      expect(response.body.role).toBe(ADMIN_ROLES.ADMIN);
      expect(response.body).not.toHaveProperty("password_hash");
    });

    it("should not allow creating admin without super admin token", async () => {
      const response = await request(app).post("/admin/auth/register").send({
        username: "unauthorized",
        email: "unauthorized@example.com",
        password: "adminpass123",
      });

      expect(response.status).toBe(401);
    });

    it("should not allow creating admin with duplicate username", async () => {
      const response = await request(app)
        .post("/admin/auth/register")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          username: "newadmin", // duplicate username
          email: "different@example.com",
          password: "adminpass123",
        });

      expect(response.status).toBe(409);
    });
  });

  describe("GET /admin/auth/profile", () => {
    it("should get admin profile with valid token", async () => {
      const response = await request(app)
        .get("/admin/auth/profile")
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("id", superAdminId);
      expect(response.body).toHaveProperty("username", "superadmin");
      expect(response.body).toHaveProperty("role", ADMIN_ROLES.SUPER_ADMIN);
    });

    it("should not get profile without token", async () => {
      const response = await request(app).get("/admin/auth/profile");

      expect(response.status).toBe(401);
    });

    it("should not get profile with invalid token", async () => {
      const response = await request(app)
        .get("/admin/auth/profile")
        .set("Authorization", "Bearer invalidtoken");

      expect(response.status).toBe(401);
    });
  });
});
