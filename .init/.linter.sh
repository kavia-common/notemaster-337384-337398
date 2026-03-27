#!/bin/bash
cd /home/kavia/workspace/code-generation/notemaster-337384-337398/notes_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

