public with sharing class NotepadController {

    // ------------------------------------------------------------------
    // Get all notes created by the running user (Home page / personal)
    // ------------------------------------------------------------------
    @AuraEnabled(cacheable=true)
    public static List<Note__c> getMyNotes(Boolean includeCompleted, Integer maxRecords) {
        Id uid = UserInfo.getUserId();
        Integer lim = (maxRecords == null || maxRecords <= 0 || maxRecords > 200) ? 50 : maxRecords;

        String soql =
            'SELECT Id, Name, Note_Text__c, Completed__c, Due_by__c, Created_Time__c, ' +
            'CreatedDate, OwnerId, Owner.Name, Owner.FirstName, Owner.LastName, Owner.SmallBannerPhotoUrl, ' +
            'FROM Note__c WHERE CreatedById = :uid';

        if (!includeCompleted) {
            soql += ' AND (Completed__c = FALSE OR Completed__c = NULL)';
        }

        soql += ' ORDER BY Due_by__c NULLS LAST, CreatedDate DESC LIMIT :lim';
        return Database.query(soql);
    }

    // ------------------------------------------------------------------
    // Create a new personal note
    // ------------------------------------------------------------------
    @AuraEnabled
    public static Id createNote(String text, Datetime dueBy) {
        if (String.isBlank(text)) {
            throw new AuraHandledException('Note text is required.');
        }
        Note__c n = new Note__c(
            Name = (text.length() > 80 ? text.substring(0, 80) : text),
            Note_Text__c = text,
            Due_by__c = dueBy,
            Created_Time__c = System.now()
        );
        insert n;
        return n.Id;
    }

    // ------------------------------------------------------------------
    // Update note text
    // ------------------------------------------------------------------
    @AuraEnabled
    public static void updateNoteText(Id noteId, String newText) {
        if (noteId == null || String.isBlank(newText)) {
            throw new AuraHandledException('Note ID and text are required.');
        }
        Note__c n = [SELECT Id FROM Note__c WHERE Id = :noteId LIMIT 1];
        n.Note_Text__c = newText;
        update n;
    }

    // ------------------------------------------------------------------
    // Toggle completion
    // ------------------------------------------------------------------
    @AuraEnabled
    public static void toggleComplete(Id noteId) {
        if (noteId == null) {
            throw new AuraHandledException('Note ID is required.');
        }
        Note__c n = [SELECT Id, Completed__c FROM Note__c WHERE Id = :noteId LIMIT 1];
        n.Completed__c = !(n.Completed__c == true);
        update n;
    }

    // ------------------------------------------------------------------
    // Delete
    // ------------------------------------------------------------------
    @AuraEnabled
    public static void deleteNote(Id noteId) {
        if (noteId == null) {
            throw new AuraHandledException('Note ID is required.');
        }
        delete [SELECT Id FROM Note__c WHERE Id = :noteId LIMIT 1];
    }
}