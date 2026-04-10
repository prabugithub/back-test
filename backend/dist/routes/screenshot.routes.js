"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const googleDrive_service_1 = require("../services/googleDrive.service");
const logger_1 = __importDefault(require("../utils/logger"));
const router = (0, express_1.Router)();
router.post('/upload', async (req, res) => {
    try {
        const { image, fileName } = req.body;
        if (!image) {
            return res.status(400).json({ error: 'No image data provided' });
        }
        const name = fileName || `screenshot-${Date.now()}.png`;
        logger_1.default.info(`Starting upload for ${name} (${image.length} characters)`);
        const link = await googleDrive_service_1.googleDriveService.uploadImage(image, name);
        logger_1.default.info(`Upload successful: ${link}`);
        res.json({ link });
    }
    catch (error) {
        logger_1.default.error('Screenshot upload failed:', error);
        res.status(500).json({
            error: 'Failed to upload to Google Drive',
            message: error.message
        });
    }
});
exports.default = router;
