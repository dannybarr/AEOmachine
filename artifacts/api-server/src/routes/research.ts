import { Router, type IRouter } from "express";
import { AEO_RESEARCH } from "../data/aeoResearch";

const router: IRouter = Router();

// Curated, source-attributed research dataset. Static by design: every figure
// comes from a published study (see `sources`), never computed or estimated.
router.get("/research/aeo", (_req, res) => {
  res.json(AEO_RESEARCH);
});

export default router;
