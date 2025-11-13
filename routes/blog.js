import { Router } from "express";
const router = Router();
import db from "../config/db.js";
import { v4 as uuidv4 } from "uuid";
import upload from "../middleware/upload.js";
import {
  uploadToCloudinary,
  uploadToCloudinaryBodyImage,
} from "../config/cloudinary.js";
import { compressImage, getImageMetadata } from "../utils/imageProcessor.js";

// Get all blogs
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 5;
    const offset = (page - 1) * limit;
    const category = req.query.category;
    const search = req.query.search;
    const sortBy = req.query.sortBy || "latest";

    // Build WHERE clause for filters
    let whereConditions = [];
    let queryParams = [];

    // Category filter
    if (category && category !== "All") {
      whereConditions.push("category = ?");
      queryParams.push(category);
    }

    // Search filter (searches in title, body, and authors)
    if (search && search.trim()) {
      whereConditions.push("(title LIKE ? OR body LIKE ?)");
      const searchPattern = `%${search.trim()}%`;
      queryParams.push(searchPattern, searchPattern);
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // Get total count with filters
    const countQuery = `SELECT COUNT(*) as total FROM blogs ${whereClause}`;
    const [countResult] = await db.query(countQuery, queryParams);
    const totalBlogs = countResult[0].total;
    const totalPages = Math.ceil(totalBlogs / limit);

    // Determine sort order
    let orderBy;
    switch (sortBy) {
      case "oldest":
        orderBy = "ORDER BY published_date ASC, created_at ASC";
        break;
      case "popular":
        orderBy = "ORDER BY comments_count DESC, published_date DESC";
        break;
      case "latest":
      default:
        orderBy = "ORDER BY published_date DESC, created_at DESC";
        break;
    }

    // Get paginated blogs with filters and sorting
    const blogsQuery = `
      SELECT id, title, published_date, category, authors, featured_image, 
             comments_count, SUBSTRING(body, 1, 480) as excerpt, created_at 
      FROM blogs 
      ${whereClause}
      ${orderBy}
      LIMIT ? OFFSET ?
    `;

    const [blogs] = await db.query(blogsQuery, [...queryParams, limit, offset]);

    // Parse JSON fields and optimize featured_image for frontend
    const blogsWithParsedData = blogs.map((blog) => {
      // Parse authors
      let authors;
      try {
        authors =
          typeof blog.authors === "string"
            ? JSON.parse(blog.authors)
            : blog.authors;
      } catch (e) {
        authors = [blog.authors];
      }

      // Parse and optimize featured_image (Cloudinary metadata)
      let featuredImage = null;
      if (blog.featured_image) {
        try {
          const imageData =
            typeof blog.featured_image === "string"
              ? JSON.parse(blog.featured_image)
              : blog.featured_image;

          // Send only essential metadata to frontend
          featuredImage = {
            public_id: imageData.public_id,
            format: imageData.format,
            resource_type: imageData.resource_type || "image",
          };
        } catch (e) {
          console.error("Error parsing featured_image:", e);
          featuredImage = null;
        }
      }

      return {
        ...blog,
        authors: authors,
        featured_image: featuredImage,
      };
    });

    res.json({
      blogs: blogsWithParsedData,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalBlogs: totalBlogs,
        limit: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      filters: {
        category: category || null,
        search: search || null,
        sortBy: sortBy,
      },
    });
  } catch (error) {
    console.error("Error fetching blogs:", error);
    res.status(500).json({ error: "Failed to fetch blogs" });
  }
});

router.get("/categories", async (req, res) => {
  try {
    const [categories] = await db.query(
      `SELECT DISTINCT category 
       FROM blogs 
       WHERE category IS NOT NULL 
       ORDER BY category ASC`
    );

    res.json({
      categories: ["All", ...categories.map((c) => c.category)],
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// Get single blog by ID (with comments)
router.get("/:id", async (req, res) => {
  try {
    const [blogs] = await db.query("SELECT * FROM blogs WHERE id = ?", [
      req.params.id,
    ]);

    if (blogs.length === 0) {
      return res.status(404).json({ error: "Blog not found" });
    }

    const blogData = blogs[0];

    // Parse authors
    let authors;
    if (typeof blogData.authors === "string") {
      try {
        authors = JSON.parse(blogData.authors);
      } catch (e) {
        authors = [blogData.authors];
      }
    } else {
      authors = blogData.authors || [];
    }

    // Parse comments - handle all cases
    let comments = [];
    if (blogData.comments !== null && blogData.comments !== undefined) {
      if (typeof blogData.comments === "string") {
        try {
          comments = JSON.parse(blogData.comments);
        } catch (e) {
          console.error("Error parsing comments string:", e);
          comments = [];
        }
      } else if (Array.isArray(blogData.comments)) {
        comments = blogData.comments;
      } else if (typeof blogData.comments === "object") {
        comments = Object.values(blogData.comments);
      }
    }

    // Parse and optimize featured_image (Cloudinary metadata)
    let featuredImage = null;
    if (blogData.featured_image) {
      try {
        const imageData =
          typeof blogData.featured_image === "string"
            ? JSON.parse(blogData.featured_image)
            : blogData.featured_image;

        // Send only essential metadata to frontend
        featuredImage = {
          public_id: imageData.public_id,
          format: imageData.format,
          resource_type: imageData.resource_type || "image",
        };
      } catch (e) {
        console.error("Error parsing featured_image:", e);
        featuredImage = null;
      }
    }

    const blog = {
      ...blogData,
      authors: authors,
      comments: comments,
      featured_image: featuredImage,
    };

    res.json(blog);
  } catch (error) {
    console.error("Error fetching blog:", error);
    res.status(500).json({ error: "Failed to fetch blog" });
  }
});

// Create new blog
router.post("/new", upload.single("featured_image"), async (req, res) => {
  try {
    const { title, published_date, category, authors, body } = req.body;

    // Validate required fields
    if (!title || !published_date || !category || !authors || !body) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Parse authors if it's a string
    let parsedAuthors;
    try {
      parsedAuthors =
        typeof authors === "string" ? JSON.parse(authors) : authors;
    } catch (e) {
      return res
        .status(400)
        .json({ error: "Invalid authors format. Must be valid JSON array." });
    }

    // Generate blog ID
    const blogId = uuidv4();

    let featuredImageData = null;

    // Handle featured image upload if provided
    if (req.file) {
      try {
        console.log("Processing image upload...");

        // Get original image metadata
        // const originalMetadata = await getImageMetadata(req.file.buffer);
        // console.log("Original image:", originalMetadata);

        // Compress image before uploading to Cloudinary
        const compressedBuffer = await compressImage(req.file.buffer);
        // console.log("Image compressed");

        // Upload to Cloudinary
        const cloudinaryResult = await uploadToCloudinary(
          compressedBuffer,
          blogId
        );
        console.log("Uploaded to Cloudinary:", cloudinaryResult.public_id);

        // Store Cloudinary metadata
        featuredImageData = {
          url: cloudinaryResult.url,
          secure_url: cloudinaryResult.secure_url,
          public_id: cloudinaryResult.public_id,
          width: cloudinaryResult.width,
          height: cloudinaryResult.height,
          format: cloudinaryResult.format,
          resource_type: cloudinaryResult.resource_type,
          created_at: cloudinaryResult.created_at,
        };
      } catch (imageError) {
        console.error("Feature Image upload error:", imageError);
        return res.status(500).json({
          error: "Failed to upload feature image",
          details: imageError.message,
        });
      }
    }

    // Insert blog into database
    await db.query(
      `INSERT INTO blogs 
       (id, title, published_date, category, authors, featured_image, body, comments_count, comments) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        blogId,
        title,
        published_date,
        category,
        JSON.stringify(parsedAuthors),
        featuredImageData ? JSON.stringify(featuredImageData) : null,
        body,
        "[]",
      ]
    );

    console.log("Blog created successfully:", blogId);

    res.status(201).json({
      message: "Blog created successfully",
      blogId: blogId,
      featuredImage: featuredImageData,
    });
  } catch (error) {
    console.error("Error creating blog:", error);
    res.status(500).json({
      error: "Failed to create blog",
      details: error.message,
    });
  }
});

router.post("/upload-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const compressedBuffer = await compressImage(req.file.buffer);

    // Upload to Cloudinary
    const result = await uploadToCloudinaryBodyImage(compressedBuffer);

    res.status(200).json({
      message: "Image uploaded successfully",
      url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
    });
  } catch (error) {
    console.error("Image upload error:", error);
    res.status(500).json({
      error: "Failed to upload image",
      details: error.message,
    });
  }
});

// Update blog
router.put("/:id", async (req, res) => {
  try {
    const { title, published_date, category, authors, featured_image, body } =
      req.body;
    const blogId = req.params.id;

    const [result] = await db.query(
      "UPDATE blogs SET title = ?, published_date = ?, category = ?, authors = ?, featured_image = ?, body = ? WHERE id = ?",
      [
        title,
        published_date,
        category,
        JSON.stringify(authors),
        featured_image,
        body,
        blogId,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Blog not found" });
    }

    res.json({ message: "Blog updated successfully" });
  } catch (error) {
    console.error("Error updating blog:", error);
    res.status(500).json({ error: "Failed to update blog" });
  }
});

// Delete blog
router.delete("/:id", async (req, res) => {
  try {
    const [result] = await db.query("DELETE FROM blogs WHERE id = ?", [
      req.params.id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Blog not found" });
    }

    res.json({ message: "Blog deleted successfully" });
  } catch (error) {
    console.error("Error deleting blog:", error);
    res.status(500).json({ error: "Failed to delete blog" });
  }
});

// Add comment to blog
// Add comment to blog
router.post("/:id/comment", async (req, res) => {
  try {
    const { name, email, text, website } = req.body;
    const blogId = req.params.id;

    if (website && website.trim() !== "") {
      return res.status(400).json({ error: "False information" });
    }

    if (!name || !email || !text) {
      return res
        .status(400)
        .json({ error: "Name, email, and text are required" });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Get current blog with explicit JSON handling
    const [blogs] = await db.query(
      "SELECT comments, comments_count FROM blogs WHERE id = ?",
      [blogId]
    );

    if (blogs.length === 0) {
      return res.status(404).json({ error: "Blog not found" });
    }

    // Parse existing comments - handle both NULL and empty array
    let currentComments = [];
    if (blogs[0].comments) {
      if (typeof blogs[0].comments === "string") {
        try {
          currentComments = JSON.parse(blogs[0].comments);
        } catch (e) {
          console.error("Error parsing comments:", e);
          currentComments = [];
        }
      } else if (Array.isArray(blogs[0].comments)) {
        // Already parsed as JSON by MySQL
        currentComments = blogs[0].comments;
      }
    }

    // Create new comment
    const newComment = {
      id: uuidv4(),
      name,
      email,
      text,
      timestamp: new Date().toISOString(),
    };

    // Add new comment to the array
    currentComments.push(newComment);

    // Update blog with new comment using JSON_SET or direct JSON
    await db.query(
      "UPDATE blogs SET comments = CAST(? AS JSON), comments_count = ? WHERE id = ?",
      [JSON.stringify(currentComments), currentComments.length, blogId]
    );

    res.status(201).json({
      message: "Comment added successfully",
      comment: newComment,
    });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// Get comments for a blog
// Get comments for a blog with pagination
router.get("/:id/comments", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const [blogs] = await db.query(
      "SELECT comments, comments_count FROM blogs WHERE id = ?",
      [req.params.id]
    );

    if (blogs.length === 0) {
      return res.status(404).json({ error: "Blog not found" });
    }

    let allComments = [];

    // Handle different types of data from MySQL
    if (blogs[0].comments !== null && blogs[0].comments !== undefined) {
      if (typeof blogs[0].comments === "string") {
        try {
          allComments = JSON.parse(blogs[0].comments);
        } catch (e) {
          console.error("Error parsing comments string:", e);
          allComments = [];
        }
      } else if (Array.isArray(blogs[0].comments)) {
        allComments = blogs[0].comments;
      } else if (typeof blogs[0].comments === "object") {
        allComments = Object.values(blogs[0].comments);
      }
    }

    // Sort comments by timestamp (newest first)
    allComments.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Calculate pagination
    const totalComments = allComments.length;
    const totalPages = Math.ceil(totalComments / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedComments = allComments.slice(startIndex, endIndex);

    res.json({
      comments: paginatedComments,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalComments: totalComments,
        limit: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      count: blogs[0].comments_count,
    });
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

// Delete a comment
router.delete("/:blogId/comment/:commentId", async (req, res) => {
  try {
    const { blogId, commentId } = req.params;

    // Get current blog
    const [blogs] = await db.query("SELECT comments FROM blogs WHERE id = ?", [
      blogId,
    ]);

    if (blogs.length === 0) {
      return res.status(404).json({ error: "Blog not found" });
    }

    // Parse and filter comments
    let comments;
    try {
      comments = JSON.parse(blogs[0].comments || "[]");
    } catch (e) {
      comments = [];
    }

    const initialLength = comments.length;
    comments = comments.filter((comment) => comment.id !== commentId);

    if (comments.length === initialLength) {
      return res.status(404).json({ error: "Comment not found" });
    }

    // Update blog
    await db.query(
      "UPDATE blogs SET comments = ?, comments_count = ? WHERE id = ?",
      [JSON.stringify(comments), comments.length, blogId]
    );

    res.json({ message: "Comment deleted successfully" });
  } catch (error) {
    console.error("Error deleting comment:", error);
    res.status(500).json({ error: "Failed to delete comment" });
  }
});
export default router;
