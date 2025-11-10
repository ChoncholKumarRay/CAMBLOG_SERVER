import { Router } from "express";
const router = Router();
import { body, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";
import db from "../config/db.js";
import { v4 as uuidv4 } from "uuid";

const submissionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: "Too many submissions, please try again later." },
});

// POST /api/submission
router.post(
  "/",
  submissionLimiter,
  [
    body("name").trim().isLength({ min: 2, max: 100 }).escape(),
    body("email").trim().isEmail().normalizeEmail(),
    body("blog_title").trim().isLength({ min: 3, max: 255 }).escape(),
    body("category").trim().isLength({ min: 1, max: 100 }).escape(),
    body("blog_content")
      .trim()
      .isLength({ min: 10, max: 2000 })
      .custom((val) => {
        const allowed =
          /^(https?:\/\/)?(docs\.google\.com|drive\.google\.com)\/.+$/i;
        if (!allowed.test(val)) {
          throw new Error("blog_content must be a Google Docs or Drive link");
        }
        return true;
      }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, email, blog_title, category, blog_content } = req.body;
      const id = uuidv4();

      await db.query(
        `INSERT INTO blog_submissions 
          (id, name, email, blog_title, category, blog_content, status, submission_time)
         VALUES (?, ?, ?, ?, ?, ?, 'Received', NOW())`,
        [id, name, email, blog_title, category, blog_content]
      );

      return res.status(201).json({
        message: "Blog submission received successfully",
        submissionId: id,
      });
    } catch (error) {
      console.error("Error submitting blog:", error);
      return res.status(500).json({ error: "Failed to submit blog" });
    }
  }
);

// Get all submissions (for admin)
router.get("/", async (req, res) => {
  try {
    const status = req.query.status; // Optional filter by status
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    let query = "SELECT * FROM blog_submissions";
    let countQuery = "SELECT COUNT(*) as total FROM blog_submissions";
    const params = [];

    // Filter by status if provided
    if (status && ["Received", "Accepted", "Published"].includes(status)) {
      query += " WHERE status = ?";
      countQuery += " WHERE status = ?";
      params.push(status);
    }

    // Add ordering and pagination
    query += " ORDER BY submission_time DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    // Get total count
    const [countResult] = await db.query(countQuery, status ? [status] : []);
    const totalSubmissions = countResult[0].total;
    const totalPages = Math.ceil(totalSubmissions / limit);

    // Get submissions
    const [submissions] = await db.query(query, params);

    res.json({
      submissions,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalSubmissions: totalSubmissions,
        limit: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching submissions:", error);
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

// Get single submission by ID
router.get("/:id", async (req, res) => {
  try {
    const [submissions] = await db.query(
      "SELECT * FROM blog_submissions WHERE id = ?",
      [req.params.id]
    );

    if (submissions.length === 0) {
      return res.status(404).json({ error: "Submission not found" });
    }

    res.json(submissions[0]);
  } catch (error) {
    console.error("Error fetching submission:", error);
    res.status(500).json({ error: "Failed to fetch submission" });
  }
});

// Update submission status
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const submissionId = req.params.id;

    // Validate status
    if (!["Received", "Accepted", "Published"].includes(status)) {
      return res.status(400).json({
        error: "Invalid status. Must be 'Received', 'Accepted', or 'Published'",
      });
    }

    const [result] = await db.query(
      "UPDATE blog_submissions SET status = ? WHERE id = ?",
      [status, submissionId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Submission not found" });
    }

    res.json({
      message: "Submission status updated successfully",
      status: status,
    });
  } catch (error) {
    console.error("Error updating submission status:", error);
    res.status(500).json({ error: "Failed to update submission status" });
  }
});

// Delete submission
router.delete("/:id", async (req, res) => {
  try {
    const [result] = await db.query(
      "DELETE FROM blog_submissions WHERE id = ?",
      [req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Submission not found" });
    }

    res.json({ message: "Submission deleted successfully" });
  } catch (error) {
    console.error("Error deleting submission:", error);
    res.status(500).json({ error: "Failed to delete submission" });
  }
});

export default router;
