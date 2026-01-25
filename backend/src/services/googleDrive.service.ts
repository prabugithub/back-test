import { google } from 'googleapis';
import { Readable } from 'stream';
import logger from '../utils/logger';

export class GoogleDriveService {
    private drive;

    constructor() {
        let clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
        let privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY;

        if (clientEmail) {
            clientEmail = clientEmail.replace(/['"]/g, '').trim();
        }

        if (privateKey) {
            // Remove quotes if present and replace literal \n with actual newlines
            privateKey = privateKey.replace(/['"]/g, '').replace(/\\n/g, '\n').trim();
        }

        if (!clientEmail || !privateKey) {
            logger.warn('Google Drive credentials missing in .env. Uploads will fail.', {
                hasEmail: !!clientEmail,
                hasKey: !!privateKey
            });
            this.drive = null;
            return;
        }

        logger.info('Initializing Google Drive service', { clientEmail });

        const auth = new google.auth.JWT({
            email: clientEmail,
            key: privateKey,
            scopes: ['https://www.googleapis.com/auth/drive.file'],
        });

        this.drive = google.drive({ version: 'v3', auth });
    }

    async uploadImage(base64Data: string, fileName: string): Promise<string> {
        // Option 1: Use Apps Script Bridge (Best for personal accounts)
        const bridgeUrl = process.env.GOOGLE_DRIVE_BRIDGE_URL;
        if (bridgeUrl) {
            logger.info('Using Google Apps Script bridge for upload...');
            try {
                const response = await fetch(bridgeUrl, {
                    method: 'POST',
                    body: JSON.stringify({ image: base64Data, fileName }),
                    headers: { 'Content-Type': 'application/json' }
                });
                const result: any = await response.json();
                if (result.success) {
                    logger.info(`Upload successful via bridge: ${result.link}`);
                    return result.link;
                }
                throw new Error(result.error || 'Bridge upload failed');
            } catch (error: any) {
                logger.error('Bridge upload failed, falling back to Service Account:', error.message);
                // Fall through to standard method
            }
        }

        // Option 2: Standard Service Account Upload
        if (!this.drive) {
            logger.error('Google Drive service not initialized. Check credentials.');
            throw new Error('Google Drive service not initialized. Check credentials.');
        }

        try {
            // Remove data:image/png;base64, prefix if exists
            const base64Content = base64Data.split(';base64,').pop() || base64Data;
            const buffer = Buffer.from(base64Content, 'base64');
            logger.info(`Buffer created for ${fileName}, size: ${buffer.length} bytes`);

            const bufferStream = new Readable();
            bufferStream.push(buffer);
            bufferStream.push(null);

            const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.replace(/['"]/g, '').trim();
            logger.info(`Uploading to folder: "${folderId || 'Root'}"`);

            const fileMetadata: any = {
                name: fileName,
                parents: folderId ? [folderId] : undefined,
            };

            const media = {
                mimeType: 'image/png',
                body: bufferStream,
            };

            logger.info('Calling drive.files.create...');
            const response = await this.drive.files.create({
                requestBody: fileMetadata,
                media: media,
                fields: 'id, webViewLink, webContentLink',
                supportsAllDrives: true,
            });

            const fileId = response.data.id;
            logger.info(`File created with ID: ${fileId}`);
            if (!fileId) throw new Error('Failed to get file ID from Google Drive');

            // Make the file publicly readable
            logger.info('Updating permissions...');
            await this.drive.permissions.create({
                fileId: fileId,
                requestBody: {
                    role: 'reader',
                    type: 'anyone',
                },
                supportsAllDrives: true, // Crucial for shared access
            });

            const result = await this.drive.files.get({
                fileId: fileId,
                fields: 'webViewLink',
                supportsAllDrives: true,
            });

            return result.data.webViewLink || '';
        } catch (error) {
            logger.error('Error uploading to Google Drive:', error);
            throw error;
        }
    }
}

export const googleDriveService = new GoogleDriveService();
