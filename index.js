import express from "express";
import cors from "cors";
import "dotenv/config";
import blogRoutes from "./routes/blog.js";
import submissionRoutes from "./routes/submissionRoute.js";
import db from "./config/db.js";

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(
  cors({
    origin: "*", // allow all origins
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // allowed methods
    allowedHeaders: ["Content-Type", "Authorization"], // allowed headers
    credentials: false, // no credentials needed for any origin
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

try {
  await db.getConnection(); // will throw error if cannot connect
  console.log("✅ Database connection successful!");
} catch (err) {
  console.error("❌ Database connection error:", err.message);
  process.exit(1); // stop server if DB not connected
}

// Routes
app.use("/api/blog/submission", submissionRoutes);
app.use("/api/blog", blogRoutes);

// Health check route
app.get("/", (req, res) => {
  res.json({ message: "Blog API is running" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
