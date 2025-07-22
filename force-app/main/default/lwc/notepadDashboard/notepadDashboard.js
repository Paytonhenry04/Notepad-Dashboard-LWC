import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

import USER_ID from '@salesforce/user/Id';

import getMyNotes from '@salesforce/apex/NotepadDashboardController.getMyNotes';
// import createNote from '@salesforce/apex/NotepadDashboardController.createNote';
import updateNoteText from '@salesforce/apex/NotepadDashboardController.updateNoteText';
// import toggleCompleteSrv from '@salesforce/apex/NotepadDashboardController.toggleComplete';
import deleteNoteSrv from '@salesforce/apex/NotepadDashboardController.deleteNote';
import getCompanyIdsByNames from '@salesforce/apex/NotepadDashboardController.getCompanyIdsByNames';


import createNoteReminder from '@salesforce/apex/NoteReminderController.createNoteReminder';
import NoteReminderExists from '@salesforce/apex/NoteReminderController.NoteReminderExists';
import removeNoteReminder from '@salesforce/apex/NoteReminderController.removeNoteReminder';

import { refreshApex } from '@salesforce/apex';

import noteEditIcon from '@salesforce/resourceUrl/noteEditIcon';
import noteDeleteIcon from '@salesforce/resourceUrl/noteDeleteIcon';
// import noteCompleteIcon from '@salesforce/resourceUrl/noteCompleteIcon';
// import noteIsCompleteIcon from '@salesforce/resourceUrl/noteIsCompleteIcon';
import noteNotifyMeOnIcon from '@salesforce/resourceUrl/noteNotifyMeOnIcon';
import noteNotfiyMeOffIcon from '@salesforce/resourceUrl/noteNotfiyMeOffIcon';

export default class NotepadDashboard extends LightningElement {
  @api includecompleted;
  @api maxrecords;

  currentUserId = USER_ID;

  @track notes = [];
  noteText = '';
  newNoteDue;
  isAdding = false;
  loading = false;

  showDeleteModal = false;
  notePendingDelete;

  wiredResult;

  editNoteIcon = noteEditIcon;
  deleteNoteIcon = noteDeleteIcon;

  @wire(getMyNotes, { includeCompleted: '$includecompleted', maxRecords: '$maxrecords' })
  wiredNotes(result) {
    this.wiredResult = result;
    const { data, error } = result;
    if (data) {
      this.notes = data.map((n) => this._mapNote(n));
      this._hydrateReminders();
      this._hydrateCompanyLinks();
      this.loading = false;
    } else if (error) {
      console.error('getMyNotes error', error);
      this._toast('Error', 'Failed to load notes.', 'error');
      this.loading = false;
    } else {
      this.loading = true;
    }
  }

  _mapNote(n) {
    const completed = n.Completed__c === true;
    const companyName = n.TargetObjectName__c; // <-- company name text that matches Company__c.Name

    return {
    ...n,
    isEditing: false,
    isCompleted: completed,
    noteTextClass: completed ? 'Note-text completed-note' : 'Note-text',
    stickyNoteClass: completed ? 'sticky-note completed' : 'sticky-note',
    completeButtonClass: completed ? 'complete-icon-button completed' : 'complete-icon-button',
    hasReminder: false,
    notifyButtonClass: 'notify-icon-button',
    notificationIconSrc: noteNotfiyMeOffIcon,
    createdDisplay: this._fmtDate(n.CreatedDate),
    dueDisplay: n.Due_by__c ? this._fmtDate(n.Due_by__c) : null,

    // --- record link fields (will be hydrated later) ---
    companyName,                         // raw text from TargetObjectName__c
    relatedRecordId: null,               // filled in after Apex lookup
    relatedRecordLink: null,             // filled in after Apex lookup
    relatedRecordName: companyName || '' // what displays in the link
    };
  }



  _fmtDate(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      const day = d.getDate().toString().padStart(2, '0');
      const year = d.getFullYear().toString().slice(-2);
      let hours = d.getHours();
      const minutes = d.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12 || 12;
      return `${month}/${day}/${year} ${hours}:${minutes}${ampm}`;
    } catch (e) {
      return iso;
    }
  }

  _hydrateReminders() {
    this.notes.forEach((note, idx) => {
      NoteReminderExists({ userId: this.currentUserId, NoteId: note.Id })
        .then((exists) => {
          const updated = { ...note };
          updated.hasReminder = exists;
          updated.notifyButtonClass = exists
            ? 'notify-icon-button pressed-notification'
            : 'notify-icon-button';
          updated.notificationIconSrc = exists
            ? noteNotifyMeOnIcon
            : noteNotfiyMeOffIcon;
          this._replaceNote(idx, updated);
        })
        .catch((err) => {
          console.error('Reminder check error', err);
        });
    });
  }

  _hydrateCompanyLinks() {
    // build unique list of non-empty names
    const names = [...new Set(
      this.notes
        .map((n) => (n.companyName ? n.companyName.trim() : ''))
        .filter((s) => s)
    )];

    if (names.length === 0) {
      return;
    }

    getCompanyIdsByNames({ names })
      .then((nameIdMap) => {
        // Update each note with link data (only if company found)
        this.notes = this.notes.map((n) => {
          const id = nameIdMap[n.companyName];
          if (id) {
            return {
              ...n,
              relatedRecordId: id,
              relatedRecordLink: `/lightning/r/${id}/view`,
              relatedRecordName: n.companyName
            };
          }
          return n; // leave as-is when no match
        });
      })
      .catch((err) => {
        // optional: toast or console
        // eslint-disable-next-line no-console
        console.error('getCompanyIdsByNames error', err);
      });
  }


  _replaceNote(index, updated) {
    this.notes = [
      ...this.notes.slice(0, index),
      updated,
      ...this.notes.slice(index + 1)
    ];
  }

  get hasNotes() {
    return this.notes && this.notes.length > 0;
  }
  toggleEdit(e) {
    const id = e.currentTarget.dataset.id;
    this.notes = this.notes.map((n) =>
      n.Id === id ? { ...n, isEditing: !n.isEditing } : n
    );
  }

  handleEditChange(e) {
    const id = e.target.dataset.id;
    const txt = e.target.value;
    this.notes = this.notes.map((n) =>
      n.Id === id ? { ...n, Note_Text__c: txt } : n
    );
  }

  cancelEdit(e) {
    const id = e.currentTarget.dataset.id;
    this.notes = this.notes.map((n) =>
      n.Id === id ? { ...n, isEditing: false } : n
    );
  }

  saveUpdatedNote(e) {
    const id = e.currentTarget.dataset.id;
    const note = this.notes.find((n) => n.Id === id);
    if (!note) return;
    updateNoteText({ noteId: id, newText: note.Note_Text__c })
      .then(() => {
        this._toast('Success', 'Note updated.', 'success');
        this.notes = this.notes.map((n) =>
          n.Id === id ? { ...n, isEditing: false } : n
        );
        return refreshApex(this.wiredResult);
      })
      .catch((err) => {
        console.error('updateNoteText error', err);
        this._toast('Error', 'Failed to update note.', 'error');
      });
  }

  confirmDelete(e) {
    const id = e.currentTarget.dataset.id;
    this.notePendingDelete = this.notes.find((n) => n.Id === id);
    this.showDeleteModal = true;
  }

  cancelDelete() {
    this.showDeleteModal = false;
    this.notePendingDelete = null;
  }

  deleteNote() {
    if (!this.notePendingDelete) return;
    const id = this.notePendingDelete.Id;
    deleteNoteSrv({ noteId: id })
      .then(() => {
        this._toast('Deleted', 'Note deleted.', 'success');
        this.cancelDelete();
        return refreshApex(this.wiredResult);
      })
      .catch((err) => {
        console.error('deleteNote error', err);
        this._toast('Error', 'Failed to delete note.', 'error');
        this.cancelDelete();
      });
  }

  toggleReminder(e) {
    const NoteId = e.currentTarget.dataset.id;
    const NoteIndex = this.notes.findIndex((n) => n.Id === NoteId);
    if (NoteIndex === -1) return;

    NoteReminderExists({ userId: this.currentUserId, NoteId })
      .then((exists) => {
        if (!exists) {
          createNoteReminder({ userId: this.currentUserId, NoteId })
            .then(() => {
              const updatedNote = { ...this.notes[NoteIndex] };
              updatedNote.hasReminder = true;
              updatedNote.notifyButtonClass = 'notify-icon-button pressed-notification';
              updatedNote.notificationIconSrc = noteNotifyMeOnIcon;
              this.notes = [
                ...this.notes.slice(0, NoteIndex),
                updatedNote,
                ...this.notes.slice(NoteIndex + 1)
              ];

              this._toast(
                'Notification Enabled',
                'You will be notified about this note.',
                'success'
              );

              refreshApex(this.wiredResult);
            })
            .catch((error) => {
              console.error('Error creating Note reminder:', error);
              this._toast(
                'Error',
                'Failed to enable notification.',
                'error'
              );
            });
        } else {
          removeNoteReminder({ userId: this.currentUserId, NoteId })
            .then(() => {
              const updatedNote = { ...this.notes[NoteIndex] };
              updatedNote.hasReminder = false;
              updatedNote.notifyButtonClass = 'notify-icon-button';
              updatedNote.notificationIconSrc = noteNotfiyMeOffIcon;
              this.notes = [
                ...this.notes.slice(0, NoteIndex),
                updatedNote,
                ...this.notes.slice(NoteIndex + 1)
              ];

              this._toast(
                'Notification Disabled',
                'You will no longer be notified about this note.',
                'success'
              );

              refreshApex(this.wiredResult);
            })
            .catch((error) => {
              console.error('Error removing Note reminder:', error);
              this._toast(
                'Error',
                'Failed to disable notification.',
                'error'
              );
            });
        }
      })
      .catch((error) => {
        console.error('Error checking Note reminder existence:', error);
      });
  }


  _toast(title, message, variant) {
    this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
  }
}
