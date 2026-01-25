import { Router, Request, Response } from 'express';
import { googleDriveService } from '../services/googleDrive.service';
import logger from '../utils/logger';

const router = Router();

router.post('/upload', async (req: Request, res: Response) => {
    try {
        const { image, fileName } = req.body;

        if (!image) {
            return res.status(400).json({ error: 'No image data provided' });
        }

        const name = fileName || `screenshot-${Date.now()}.png`;
        logger.info(`Starting upload for ${name} (${image.length} characters)`);
        const link = await googleDriveService.uploadImage(image, name);
        logger.info(`Upload successful: ${link}`);

        res.json({ link });
    } catch (error: any) {
        logger.error('Screenshot upload failed:', error);
        res.status(500).json({
            error: 'Failed to upload to Google Drive',
            message: error.message
        });
    }
});

export default router;
