import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

async function diagnose() {
    const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL?.replace(/['"]/g, '').trim();
    let privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY;
    if (privateKey) {
        privateKey = privateKey.replace(/['"]/g, '').replace(/\\n/g, '\n').trim();
    }
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();

    console.log('--- DIAGNOSTICS ---');
    console.log('Email:', clientEmail);
    console.log('Folder ID:', folderId);

    if (!clientEmail || !privateKey || !folderId) {
        console.error('Missing credentials');
        return;
    }

    const auth = new google.auth.JWT({
        email: clientEmail,
        key: privateKey,
        scopes: ['https://www.googleapis.com/auth/drive'],
    });

    const drive = google.drive({ version: 'v3', auth });

    try {
        console.log('Attempting to get folder metadata...');
        const response = await drive.files.get({
            fileId: folderId,
            fields: 'id, name, mimeType',
            // supportsAllDrives: true, // Try if it's a shared drive
        });
        console.log('Success! Folder found:', response.data);
    } catch (err: any) {
        console.error('FAILED to find folder.');
        console.error('Error Code:', err.code);
        console.error('Error Message:', err.message);

        if (err.code === 404) {
            console.log('\nSUGGESTION: The service account cannot see this folder.');
            console.log('1. Verify the Folder ID is correct (copy from URL after /folders/).');
            console.log(`2. Share the folder with "${clientEmail}" and give it "Editor" role.`);
        }
    }
}

diagnose();
