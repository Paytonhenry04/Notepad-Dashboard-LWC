/**
 * NoteController handles Note-related logic for the creation of a Note object on a sticky note.
 * It supports viewing, creating, and updating Note__c records
 * related to Company__c or Product2 records. These Notes are used 
 * to capture important contextual notes (e.g. meeting insights, strategy docs).
 */


public with sharing class NoteController {
    
    /** This method fetches all Notes related to a given company or product record.
     * Called by LWC compnenet to display Note history.
     * 
     * @param record ID - Id of the company or product record
     * @param objectApiName - API name of the parent objcect to determine context 
     * @return - List of Note records sorted (newest first)
     */

    @AuraEnabled(cacheable=true)
    public static List<Note__c> getNotesForRecord(Id recordId, String objectApiName) {
        String recordName = getRecordName(recordId, objectApiName);
        List<Note__c> Notes = [SELECT Id, OwnerId, CreatedDate, Note_Text__c,
                                Completed__c,
                                Owner.Id, Owner.Name, Owner.FirstName, Owner.LastName
                                FROM Note__c
                                WHERE TargetObjectType__c = :objectApiName
                                AND TargetObjectName__c = :recordName
                                AND (Public__c = TRUE OR CreatedById = :UserInfo.getUserId())
                                ORDER BY CreatedDate DESC];
        
        return Notes;
    }
    
    /** Creates a new Note for a specified company or product record.
     * Used by the agent or user input to log meeting summaries, insights, etc.
     * 
     * @param recordID - Id of the company or poduct record to relate the Note to 
     * @param objectAPIName - Used to determine whether to assign to company or product
     * @return Id of the newly created Note record. 
     */

    @AuraEnabled
    public static Id createNote(Id recordId, String objectApiName, String text) {
        String recordName = getRecordName(recordId, objectApiName);
        Note__c Note = new Note__c(Note_Text__c = text);
        Note.TargetObjectType__c = objectApiName;
        Note.TargetObjectName__c = recordName;
        try {
            insert Note;
        } catch (Exception e) {
            throw new AuraHandledException('Note insert failed: ' + e.getMessage());
        }
        return Note.Id;
    }
    /** Updates the text content of an existing Note.
     * Enables inline editing of Notes from the UI.
     * 
     * @param NoteId - the id of the Note record to be updated
     * @param newText - The updated Note text
     */

    @AuraEnabled
    public static void updateNote(Id NoteId, String newText) {
        Note__c Note = [SELECT Id FROM Note__c WHERE Id = :NoteId];
        Note.Note_Text__c = newText;
        update Note;
    }
    @AuraEnabled
    public static void deleteNote(Id NoteId) {
        delete [SELECT Id FROM Note__c WHERE Id = :NoteId];
    }

    @AuraEnabled
    public static String getRecordName(Id recordId, String objectApiName) {
        if (recordId == null || String.isBlank(objectApiName)) {
            throw new AuraHandledException('Both recordId and objectApiName are required.');
        }

        String query = 'SELECT Name FROM ' + objectApiName + ' WHERE Id = :recordId';
        try {
            SObject result = Database.query(query);
            String nameValue = (String)result.get('Name');

            if (String.isBlank(nameValue)) {
                throw new AuraHandledException('Record found, but Name field is empty.');
            }

            return nameValue;

        } catch (Exception e) {
            throw new AuraHandledException('Could not find record or query failed: ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static void updateNoteCompleteStatus(Id noteId, Boolean status) {
        try {
            System.debug('updateNoteCompleteStatus called with noteId: ' + noteId + ', status: ' + status);
            
            Note__c note = [SELECT Id, Completed__c FROM Note__c WHERE Id = :noteId LIMIT 1];
            System.debug('Found note: ' + note.Id + ', current Completed__c: ' + note.Completed__c);
            
            note.Completed__c = status;
            update note;
            
            System.debug('Successfully updated note completion status to: ' + status);
        } catch (QueryException qe) {
            System.debug('Query exception: ' + qe.getMessage());
            throw new AuraHandledException('Note not found: ' + noteId);
        } catch (DmlException dml) {
            System.debug('DML exception: ' + dml.getMessage());
            throw new AuraHandledException('Failed to update note - DML Error: ' + dml.getMessage());
        } catch (Exception e) {
            System.debug('General exception: ' + e.getMessage());
            throw new AuraHandledException('Failed to update note: ' + e.getMessage());
        }
    }
}