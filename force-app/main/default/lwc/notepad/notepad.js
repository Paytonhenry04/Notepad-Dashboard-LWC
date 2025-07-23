import { LightningElement, api, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import USER_ID from '@salesforce/user/Id';
import { refreshApex } from '@salesforce/apex';

import getNotesForRecord from '@salesforce/apex/NoteController.getNotesForRecord';
import createNote from '@salesforce/apex/NoteController.createNote';
import updateNote from '@salesforce/apex/NoteController.updateNote';
import deleteNote from '@salesforce/apex/NoteController.deleteNote';
import updateNoteCompleteStatus from '@salesforce/apex/NoteController.updateNoteCompleteStatus';

import createNoteReminder from '@salesforce/apex/NoteReminderController.createNoteReminder';
import NoteReminderExists from '@salesforce/apex/NoteReminderController.NoteReminderExists';
import removeNoteReminder from '@salesforce/apex/NoteReminderController.removeNoteReminder';


import noteEditIcon from '@salesforce/resourceUrl/noteEditIcon';
import noteDeleteIcon from '@salesforce/resourceUrl/noteDeleteIcon';
import noteCompleteIcon from '@salesforce/resourceUrl/noteCompleteIcon';
import noteIsCompleteIcon from '@salesforce/resourceUrl/noteIsCompleteIcon';
import noteNotfiyMeOffIcon from '@salesforce/resourceUrl/noteNotfiyMeOffIcon';
import noteNotifyMeOnIcon from '@salesforce/resourceUrl/noteNotifyMeOnIcon';

export default class notepad extends LightningElement {
  @api recordId;
  @api objectApiName;
  currentUserId = USER_ID;


  Notes = [];
  NoteText = '';
  isAdding = false;
  wiredResult;
  
  // Delete confirmation modal state
  showDeleteConfirmation = false;
  noteToDelete = null;

  formatCreatedDate(isoDateString) {
    if (!isoDateString) return '';
    
    const date = new Date(isoDateString);
    
    // Format date as MM/DD/YY
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const year = date.getFullYear().toString().slice(-2);
    
    // Format time as HH:MMam/pm
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12; // 0 should be 12
    
    return `${month}/${day}/${year} ${hours}:${minutes}${ampm}`;
  }

  @wire(getNotesForRecord, { recordId: '$recordId', objectApiName: '$objectApiName' })
    wiredNotes(result) {
      this.wiredResult = result;
      const { data, error } = result;
      if (data) {
        console.log('Raw data from Apex:', JSON.stringify(data, null, 2)); // Debug log
        
        // First map the data with additional properties
        let mappedNotes = data.map(m => ({
          ...m,
          isEditing: false,
          isOwner: m.OwnerId === this.currentUserId,
          hasReminder: false, // default until checked
          notificationIconSrc: this.noteNotfiyMeOffIcon, // default to off icon
          ownerName: m.Owner && m.Owner.Name ? m.Owner.Name : (m.OwnerId ? 'Loading...' : 'Unknown User'), // Safer access to owner name
          ownerFirstName: m.Owner ? m.Owner.FirstName : '', // Get owner first name
          ownerLastName: m.Owner ? m.Owner.LastName : '', // Get owner last name
          ownerPhotoUrl: m.Owner ? m.Owner.SmallBannerPhotoUrl : '', // Get owner photo URL
          isCompleted: m.Completed__c || false, // initialize from backend field
          noteTextClass: (m.Completed__c) ? 'Note-text completed-note' : 'Note-text', // CSS class approach
          stickyNoteClass: (m.Completed__c) ? 'sticky-note completed' : 'sticky-note', // Background color class
          completeIconSrc: (m.Completed__c) ? this.noteIsCompleteIcon : this.noteCompleteIcon, // Complete icon source
          completeButtonClass: (m.Completed__c) ? 'complete-icon-button completed' : 'complete-icon-button', // Complete button class
          CreatedDate: this.formatCreatedDate(m.CreatedDate) // Format the created date
        }));

        // Keep original order (no sorting)
        this.Notes = mappedNotes;

        console.log('Processed Notes:', JSON.stringify(this.Notes, null, 2)); // Debug log

        // Then for each Note, check reminder existence and update icon
        this.Notes.forEach((Note, index) => {
          NoteReminderExists({ userId: this.currentUserId, NoteId: Note.Id })
            .then(exists => {
              const updatedNote = { ...Note };
              updatedNote.hasReminder = exists;
              updatedNote.notificationIconSrc = exists ? this.noteNotifyMeOnIcon : this.noteNotfiyMeOffIcon;

              // Update Note reactively
              this.Notes = [
                ...this.Notes.slice(0, index),
                updatedNote,
                ...this.Notes.slice(index + 1)
              ];
            })
            .catch(error => {
              console.error('Error checking Note reminder existence for Note:', Note.Id, error);
            });
        });


      } else if (error) {
        console.error(error);
      }
    }


  startNewNote() {
    this.isAdding = true;
  }

  cancelNote() {
    this.isAdding = false;
    this.NoteText = '';
  }

  handleTextChange(event) {
    this.NoteText = event.target.value;
  }

  handleNotifyMe(event) {
    const NoteId = event.currentTarget.dataset.id;

    // Find index of the Note being updated
    const NoteIndex = this.Notes.findIndex(Note => Note.Id === NoteId);
    if (NoteIndex === -1) return; // Safety check

    NoteReminderExists({ userId: this.currentUserId, NoteId: NoteId })
      .then(exists => {
        if (!exists) {
          createNoteReminder({ userId: this.currentUserId, NoteId: NoteId })
            .then(() => {
              console.log("Created NoteReminder");

              // Optimistically update UI
              const updatedNote = { ...this.Notes[NoteIndex] };
              updatedNote.hasReminder = true;
              updatedNote.notificationIconSrc = this.noteNotifyMeOnIcon;
              this.Notes = [
                ...this.Notes.slice(0, NoteIndex),
                updatedNote,
                ...this.Notes.slice(NoteIndex + 1)
              ];

              // Show success toast
              this.dispatchEvent(new ShowToastEvent({
                title: 'Notification Enabled',
                message: 'You will be notified about this note.',
                variant: 'success'
              }));

              refreshApex(this.wiredResult);
            })
            .catch(error => {
              console.error("Error creating Note reminder:", error);
              
              // Show error toast
              this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: 'Failed to enable notification.',
                variant: 'error'
              }));
            });
        } else {
          removeNoteReminder({ userId: this.currentUserId, NoteId: NoteId })
            .then(() => {
              console.log("Removed NoteReminder");

              // Optimistically update UI
              const updatedNote = { ...this.Notes[NoteIndex] };
              updatedNote.hasReminder = false;
              updatedNote.notificationIconSrc = this.noteNotfiyMeOffIcon;
              this.Notes = [
                ...this.Notes.slice(0, NoteIndex),
                updatedNote,
                ...this.Notes.slice(NoteIndex + 1)
              ];

              // Show success toast
              this.dispatchEvent(new ShowToastEvent({
                title: 'Notification Disabled',
                message: 'You will no longer be notified about this note.',
                variant: 'success'
              }));

              refreshApex(this.wiredResult);
            })
            .catch(error => {
              console.error("Error removing Note reminder:", error);
              
              // Show error toast
              this.dispatchEvent(new ShowToastEvent({
                title: 'Error',
                message: 'Failed to disable notification.',
                variant: 'error'
              }));
            });
        }
      })
      .catch(error => {
        console.error("Error checking Note reminder existence:", error);
      });
  }




  saveNote() {
    if (!this.NoteText) return;
    createNote({ recordId: this.recordId, objectApiName: this.objectApiName, text: this.NoteText })
      .then(() => {
        this.isAdding = false;
        this.NoteText = '';
        return refreshApex(this.wiredResult);
      })
      .catch(err => console.error(err));
  }

  toggleEdit(event) {
    const id = event.currentTarget.dataset.id;
    this.Notes = this.Notes.map(Note => ({
      ...Note,
      isEditing: Note.Id === id ? !Note.isEditing : Note.isEditing
    }));
  }

  handleEditChange(event) {
    const id = event.target.dataset.id;
    const newText = event.target.value;

    this.Notes = this.Notes.map(Note => {
      if (Note.Id === id) {
        return { ...Note, Note_Text__c: newText };
      }
      return Note;
    });
  }

  saveUpdatedNote(event) {
    const id = event.currentTarget.dataset.id;
    const Note = this.Notes.find(m => m.Id === id);

    updateNote({ NoteId: id, newText: Note.Note_Text__c })
      .then(() => {
        this.Notes = this.Notes.map(m => ({
          ...m,
          isEditing: m.Id === id ? false : m.isEditing
        }));
      })
      .catch(error => console.error('Error saving Note:', error));
  }

  stopPropagation(event) {
    event.stopPropagation();
  }
  
  deleteNoteRecord(event) {
    const id = event.currentTarget.dataset.id;
    const note = this.Notes.find(n => n.Id === id);
    
    // Show confirmation modal
    this.noteToDelete = note;
    this.showDeleteConfirmation = true;
  }
  
  confirmDelete() {
    if (this.noteToDelete) {
      deleteNote({ NoteId: this.noteToDelete.Id })
        .then(() => {
          this.showDeleteConfirmation = false;
          this.noteToDelete = null;
          return refreshApex(this.wiredResult);
        })
        .catch(error => {
          console.error('Error deleting Note:', error);
          this.showDeleteConfirmation = false;
          this.noteToDelete = null;
          
          // Show error toast
          this.dispatchEvent(new ShowToastEvent({
            title: 'Error',
            message: 'Failed to delete note.',
            variant: 'error'
          }));
        });
    }
  }
  
  cancelDelete() {
    this.showDeleteConfirmation = false;
    this.noteToDelete = null;
  }
  
  getNotifyButtonClass(Note) {
    return Note.hasReminder ? 'slds-button_icon pressed-notification' : 'slds-button_icon';
  }

  handleComplete(event) {
    const id = event.currentTarget.dataset.id;
    
    // Get the current note to know its completion status
    const currentNote = this.Notes.find(note => note.Id === id);
    const newCompletionStatus = !currentNote.isCompleted;
    
    // Find the note and toggle its completion status
    this.Notes = this.Notes.map(note => {
      if (note.Id === id) {
        // Update the note's completion status
        return { 
          ...note, 
          isCompleted: newCompletionStatus,
          noteTextClass: newCompletionStatus ? 'Note-text completed-note' : 'Note-text',
          stickyNoteClass: newCompletionStatus ? 'sticky-note completed' : 'sticky-note',
          completeIconSrc: newCompletionStatus ? this.noteIsCompleteIcon : this.noteCompleteIcon,
          completeButtonClass: newCompletionStatus ? 'complete-icon-button completed' : 'complete-icon-button'
        };
      }
      return note;
    });

    // No sorting needed - keep original order

    // Call the Apex method to update the backend
    updateNoteCompleteStatus({ noteId: id, status: newCompletionStatus })
      .then(() => {
        console.log('Note completion status updated successfully');
        
        const messageResponse = newCompletionStatus ? 'completed' : 'uncompleted';

        this.dispatchEvent(new ShowToastEvent({
          title: 'Note Updated',
          message: 'Note successfully ' + messageResponse + '.',
          variant: 'success'
        }));
      })
      .catch(error => {
        console.error('Error updating note completion status:', error);
        
        // Revert the UI change if backend update fails
        this.Notes = this.Notes.map(n => {
          if (n.Id === id) {
            return {
              ...n,
              isCompleted: !newCompletionStatus, // revert to original status
              noteTextClass: !newCompletionStatus ? 'Note-text completed-note' : 'Note-text',
              stickyNoteClass: !newCompletionStatus ? 'sticky-note completed' : 'sticky-note',
              completeIconSrc: !newCompletionStatus ? this.noteIsCompleteIcon : this.noteCompleteIcon,
              completeButtonClass: !newCompletionStatus ? 'complete-icon-button completed' : 'complete-icon-button'
            };
          }
          return n;
        });

        // No sorting needed - keep original order
        
        // Show user-friendly error message
        this.dispatchEvent(new ShowToastEvent({
          title: 'Error',
          message: 'Failed to update note completion status',
          variant: 'error'
        }));
      });
  }

  get editNoteIcon() {
    return noteEditIcon;
  }

  get deleteNoteIcon() {
    return noteDeleteIcon;
  }

  get noteCompleteIcon() {
    return noteCompleteIcon;
  }

  get noteIsCompleteIcon() {
    return noteIsCompleteIcon;
  }

  get noteNotfiyMeOffIcon() {
    return noteNotfiyMeOffIcon;
  }

  get noteNotifyMeOnIcon(){
    return noteNotifyMeOnIcon;
  }
}