import express from "express";
import { body, validationResult } from "express-validator";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js"; // adjust this import to your DB connection file path

const router = express.Router();

// Rate limiter: max 10 submissions per IP per minute
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

export default router;
