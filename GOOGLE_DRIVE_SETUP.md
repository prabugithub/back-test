# Google Drive Screenshot Automation Setup

To enable the automated screenshot upload feature, follow these steps:

## 1. Create a Google Cloud Project & Service Account
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., "Backtest Screenshots").
3. Go to **APIs & Services > Library**.
4. Search for **Google Drive API** and click **Enable**.
5. Go to **APIs & Services > Credentials**.
6. Click **Create Credentials > Service Account**.
7. Name it "backtest-uploader" and click **Create and Continue**, then **Done**.

## 2. Generate a JSON Key
1. In the Service Accounts list, click on the one you just created.
2. Go to the **Keys** tab.
3. Click **Add Key > Create new key**.
4. Select **JSON** and click **Create**. A file will be downloaded.

## 3. Update your `.env` file
Open the downloaded JSON file and your `backend/.env` file. Fill in the following:

- `GOOGLE_DRIVE_CLIENT_EMAIL`: Copy `client_email` from the JSON.
- `GOOGLE_DRIVE_PRIVATE_KEY`: Copy `private_key` from the JSON. 
  - **IMPORTANT**: Ensure it is wrapped in quotes and that the newlines (`\n`) are preserved.
- `GOOGLE_DRIVE_FOLDER_ID` (Optional but recommended):
  1. Open Google Drive in your browser.
  2. Create a folder (e.g., "Trading Screenshots").
  3. Copy the ID from the URL (the part after `folders/`).
  4. Paste it as `GOOGLE_DRIVE_FOLDER_ID`.

## 4. Share the folder with the Service Account
1. Right-click your "Trading Screenshots" folder in Google Drive.
2. Click **Share**.
3. Paste the `client_email` (from the service account) into the "Add people and groups" box.
4. Set the role to **Editor**.
5. Click **Send**.

## How it works
1. When you click the **Camera** icon on the chart, the system captures the chart and any drawings.
2. It sends the image to your backend.
3. The backend uploads it to the specified Google Drive folder.
4. The backend makes the file readable by anyone (so you can view the link).
5. The shareable link is **automatically copied to your clipboard**.
