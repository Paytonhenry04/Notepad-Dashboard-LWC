public with sharing class NotepadDashboardController {

    @AuraEnabled(cacheable=true)
    public static Map<String, Id> getCompanyIdsByNames(List<String> names) {
    Map<String, Id> result = new Map<String, Id>();
    if (names == null || names.isEmpty()) {
        return result;
    }

    // Dedup incoming names (case-sensitive; adjust if needed)
    Set<String> nameSet = new Set<String>(names);

    for (Company__c c : [
        SELECT Id, Name
        FROM Company__c
        WHERE Name IN :nameSet
    ]) {
        // Only store the first Id if duplicate names exist
        if (!result.containsKey(c.Name)) {
            result.put(c.Name, c.Id);
        }
    }
    return result;
    }

    @AuraEnabled(cacheable=true)
    public static List<Note__c> getMyNotes(Boolean includeCompleted, Integer maxRecords) {
        Id uid = UserInfo.getUserId();
        Integer lim = (maxRecords == null || maxRecords <= 0 || maxRecords > 200) ? 50 : maxRecords;

        Boolean showCompleted = (includeCompleted == true);

        if (showCompleted) {
            return [
                SELECT Id, Name, Note_Text__c, Completed__c, Due_by__c, Created_Time__c,
                       CreatedDate, OwnerId, Owner.Name, Owner.FirstName, Owner.LastName, TargetObjectName__c, TargetObjectType__c
                FROM Note__c
                WHERE CreatedById = :uid
                ORDER BY Due_by__c NULLS LAST, CreatedDate DESC
                LIMIT :lim
            ];
        } else {
            return [
                SELECT Id, Name, Note_Text__c, Completed__c, Due_by__c, Created_Time__c,
                       CreatedDate, OwnerId, Owner.Name, Owner.FirstName, Owner.LastName, TargetObjectName__c, TargetObjectType__c
                FROM Note__c
                WHERE CreatedById = :uid
                  AND (Completed__c = FALSE OR Completed__c = NULL)
                ORDER BY Due_by__c NULLS LAST, CreatedDate DESC
                LIMIT :lim
            ];
        }
    }


    // @AuraEnabled
    // public static Id createNote(String text, Datetime dueBy) {
    //     if (String.isBlank(text)) {
    //         throw new AuraHandledException('Note text is required.');
    //     }
    //     Note__c n = new Note__c(
    //         Name = (text.length() > 80 ? text.substring(0, 80) : text),
    //         Note_Text__c = text,
    //         Due_by__c = dueBy,
    //         Created_Time__c = System.now()
    //     );
    //     insert n;
    //     return n.Id;
    // }

    @AuraEnabled
    public static void updateNoteText(Id noteId, String newText) {
        if (noteId == null || String.isBlank(newText)) {
            throw new AuraHandledException('Note ID and text are required.');
        }
        Note__c n = [SELECT Id FROM Note__c WHERE Id = :noteId LIMIT 1];
        n.Note_Text__c = newText;
        update n;
    }

    @AuraEnabled
    public static void toggleComplete(Id noteId) {
        if (noteId == null) {
            throw new AuraHandledException('Note ID is required.');
        }
        Note__c n = [SELECT Id, Completed__c FROM Note__c WHERE Id = :noteId LIMIT 1];
        n.Completed__c = (n.Completed__c == true) ? false : true;
        update n;
    }

    @AuraEnabled
    public static void deleteNote(Id noteId) {
        if (noteId == null) {
            throw new AuraHandledException('Note ID is required.');
        }
        delete [SELECT Id FROM Note__c WHERE Id = :noteId LIMIT 1];
    }

    @AuraEnabled(cacheable=true)
    public static Boolean NoteReminderExists(Id userId, Id noteId) {
        Id uId = (userId != null) ? userId : UserInfo.getUserId();
        return [SELECT COUNT() FROM Note_Reminder__c
                WHERE User__c = :uId AND Note__c = :noteId] > 0;
    }

    @AuraEnabled
    public static void createNoteReminder(Id userId, Id noteId) {
        Id uId = (userId != null) ? userId : UserInfo.getUserId();
        if (noteId == null) throw new AuraHandledException('NoteId is required');
        Note_Reminder__c reminder = new Note_Reminder__c(
            Name = 'Reminder for ' + noteId,
            Note__c = noteId,
            User__c = uId
        );
        insert reminder;
    }

    @AuraEnabled
    public static void removeNoteReminder(Id userId, Id noteId) {
        Id uId = (userId != null) ? userId : UserInfo.getUserId();
        List<Note_Reminder__c> reminders = [SELECT Id FROM Note_Reminder__c
                                            WHERE User__c = :uId AND Note__c = :noteId];
        delete reminders;
    }

}

